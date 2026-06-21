import { supabase } from './supabase'
import type { Product, Category } from '../types'

// Maps vending-dash product types to kiosk categories
const typeToCategory: Record<string, Category> = {
  'Energy Drink': 'energy',
  'Soda':         'soda',
  'Drink':        'soda',
  'Other Drink':  'other-drinks',
  'Ice Cream':    'ice-cream',
  'Food':         'food',
  'Snacks':       'snacks',
  'Chips':        'chips',
  'Candy':        'candy',
  'Other':        'snacks',
}

// Open market kiosk — loads active products assigned to this machine.
// Product assignments are managed via Store Inventory → checkboxes in vending-dash,
// stored in app_config['machineProductIds'] keyed by machine DB id (e.g. 'm1').
// The kiosk config stores the machine CODE (e.g. 'SF1'), so we look up the DB id first.
export async function loadMarketProducts(machineCode: string): Promise<Product[]> {
  try {
    // ── Step 1: resolve machine code → database id ───────────────────────
    // machineProductIds is keyed by machine.id (e.g. 'm1'), not machine.code ('SF1')
    const { data: machineRow, error: machineErr } = await supabase
      .from('machines')
      .select('id')
      .eq('code', machineCode)
      .maybeSingle()

    if (machineErr) console.warn('[kiosk] machine lookup error for', machineCode, machineErr)

    // Use the DB id if found; fall back to the code itself (handles edge cases)
    const machineDbId = machineRow?.id ?? machineCode
    console.log('[kiosk] machine lookup:', machineCode, '→', machineDbId)

    // ── Step 2: read per-machine config (assignments + operator Sold-Out list) ─
    let productIds: string[] | null = null
    let hiddenIds: string[] = []                          // manually marked sold-out

    // We only need assignments + the Sold-Out list. machineProductOnHand /
    // machineProductPar are intentionally NOT fetched anymore: the kiosk no
    // longer auto-hides on stock count (see availability note below), and
    // skipping those two large configs (~40KB combined) trims the load payload.
    const { data: configRows } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['machineProductIds', 'machineHidden'])

    const cfg = (k: string) => configRows?.find((r: { key: string; value: unknown }) => r.key === k)?.value
    const pick = <T,>(m: Record<string, T> | undefined): T | undefined => m?.[machineDbId] ?? m?.[machineCode]

    const assignments = cfg('machineProductIds') as Record<string, string[]> | undefined
    const ids = pick(assignments)
    if (Array.isArray(ids) && ids.length > 0) productIds = ids

    hiddenIds = pick(cfg('machineHidden') as Record<string, string[]> | undefined) ?? []

    // ── Step 3: load products, filtered by this machine's assignment ──────
    // Safety: if no assignment is found we show NOTHING rather than the entire
    // catalog. On a live machine, dumping all ~225 SKUs would let customers buy
    // items that aren't physically present (unfulfillable sale). An empty
    // storefront is the correct, loud signal that Machine Inventory needs setup.
    if (!productIds) {
      console.warn('[kiosk] No product assignments for', machineCode, '(db id:', machineDbId, ') — showing no products. Assign products + pars in vending-dash → Machine Inventory.')
      return []
    }

    const { data, error } = await supabase
      .from('products')
      .select('id, name, upc, type, sellPrice')
      .eq('status', 'Active')
      .in('id', productIds)

    if (error || !data?.length) {
      console.warn('[kiosk] Failed to load products', error)
      return []
    }

    const hiddenSet = new Set(hiddenIds)

    return data
      // Never surface a $0 / unpriced item — that would be a free checkout.
      .filter((p: any) => (parseFloat(p.sellPrice) || 0) > 0)
      .map((p: any): Product => {
      // A product is unavailable ONLY when an operator explicitly marks it Sold
      // Out (machineHidden) in vending-dash → Machine Inventory. We deliberately
      // do NOT auto-hide on a 0 on-hand count: in this micro-market the customer
      // grabs the physical item, and on-hand figures are seeded from historical
      // imports (which drove best-sellers to 0), so auto-hiding silently erased
      // real, in-stock products from the storefront. The kiosk now mirrors the
      // assigned catalog 1:1; depletion is handled by the explicit Sold Out toggle.
      const manuallyHidden = hiddenSet.has(p.id)
      return {
        id:        p.id,
        name:      p.name,
        upc:       (p.upc ?? '').trim(),
        price:     parseFloat(p.sellPrice) || 0,
        category:  (typeToCategory[p.type] ?? 'snacks') as Category,
        available: !manuallyHidden,
      }
    })
  } catch (err) {
    console.warn('[kiosk] Supabase connection error', err)
    return []
  }
}
