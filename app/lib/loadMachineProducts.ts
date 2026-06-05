import { supabase } from './supabase'
import type { Product, Category } from '../types'

// Maps vending-dash product types to kiosk categories
const typeToCategory: Record<string, Category> = {
  'Energy Drink': 'energy',
  'Drink':        'drinks',
  'Other Drink':  'drinks',
  'Ice Cream':    'food',
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
    const { data: machineRow } = await supabase
      .from('machines')
      .select('id')
      .eq('code', machineCode)
      .single()

    // Use the DB id if found; fall back to the code itself (handles edge cases)
    const machineDbId = machineRow?.id ?? machineCode

    // ── Step 2: read per-machine product assignments ──────────────────────
    let productIds: string[] | null = null

    const { data: configRow } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'machineProductIds')
      .single()

    if (configRow?.value) {
      const allAssignments = configRow.value as Record<string, string[]>
      // Try DB id first, then code as fallback
      const ids = allAssignments[machineDbId] ?? allAssignments[machineCode]
      if (Array.isArray(ids) && ids.length > 0) {
        productIds = ids
      }
    }

    // ── Step 3: load products, filtered by assignment if available ────────
    let query = supabase
      .from('products')
      .select('id, name, upc, type, sellPrice')
      .eq('status', 'Active')

    if (productIds) {
      query = query.in('id', productIds)
    } else {
      // No assignments found — log and load all active products
      console.info('[kiosk] No product assignments for', machineCode, '(db id:', machineDbId, ') — loading all active products')
    }

    const { data, error } = await query

    if (error || !data?.length) {
      console.warn('[kiosk] Failed to load products', error)
      return []
    }

    return data.map((p: any): Product => ({
      id:        p.id,
      name:      p.name,
      upc:       (p.upc ?? '').trim(),
      price:     parseFloat(p.sellPrice) || 0,
      category:  (typeToCategory[p.type] ?? 'snacks') as Category,
      available: true,
    }))
  } catch (err) {
    console.warn('[kiosk] Supabase connection error', err)
    return []
  }
}
