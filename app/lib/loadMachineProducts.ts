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

    // ── Step 2: read this machine's product assignments ───────────────────
    // Only machineProductIds is read. The kiosk intentionally fetches NO
    // stock/sold-out config: per Jeff (2026-06-21) every assigned product stays
    // on the storefront at all times. Items are hand-scanned, so a customer can
    // only buy what's physically in hand — an out-of-stock item simply never
    // gets scanned. Nothing is ever removed from the kiosk for availability.
    let productIds: string[] | null = null

    const { data: configRows } = await supabase
      .from('app_config')
      .select('key, value')
      .eq('key', 'machineProductIds')

    const cfg = (k: string) => configRows?.find((r: { key: string; value: unknown }) => r.key === k)?.value
    const pick = <T,>(m: Record<string, T> | undefined): T | undefined => m?.[machineDbId] ?? m?.[machineCode]

    const assignments = cfg('machineProductIds') as Record<string, string[]> | undefined
    const ids = pick(assignments)
    if (Array.isArray(ids) && ids.length > 0) productIds = ids

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

    return data
      // Never surface a $0 / unpriced item — that would be a free checkout.
      // (Not an availability rule — a safety guard against a missing price.)
      .filter((p: any) => (parseFloat(p.sellPrice) || 0) > 0)
      .map((p: any): Product => ({
        id:        p.id,
        name:      p.name,
        upc:       (p.upc ?? '').trim(),
        price:     parseFloat(p.sellPrice) || 0,
        category:  (typeToCategory[p.type] ?? 'snacks') as Category,
        // Always available. The kiosk never removes an assigned item for being
        // out of stock or marked sold out — hand-scanning is the only gate
        // (you can't scan what isn't physically on the shelf). See Step 2.
        available: true,
      }))
  } catch (err) {
    console.warn('[kiosk] Supabase connection error', err)
    return []
  }
}
