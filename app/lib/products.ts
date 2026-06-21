import type { Product } from '../types'

// ─── Master product catalog ────────────────────────────────────────────────
// Edit prices and availability in the Admin Panel.
// In Phase 2 (Supabase) this will be fetched from the database.

export const PRODUCTS: Product[] = [
  // ── Energy Drinks ──
  { id: 'monster-original',  name: 'Monster Energy Original 16oz',    price: 3.25, category: 'energy',   upc: '070847811695', available: true },
  { id: 'monster-ultra',     name: 'Monster Ultra White 16oz',        price: 3.25, category: 'energy',   upc: '070847016663', available: true },
  { id: 'redbull-8oz',       name: 'Red Bull Energy 8.4oz',           price: 3.50, category: 'energy',   upc: '611269991000', available: true },
  { id: 'bang-cotton-candy', name: 'Bang Energy Cotton Candy 16oz',   price: 3.25, category: 'energy',   upc: '852010002556', available: true },
  { id: 'celsius-peach',     name: 'Celsius Peach Mango 12oz',        price: 3.25, category: 'energy',   upc: '889392000011', available: true },
  { id: 'reign-melon',       name: 'Reign Watermelon Warlord 16oz',   price: 3.25, category: 'energy',   upc: '611269992014', available: true },

  // ── Soda ──
  { id: 'coke-20oz',         name: 'Coca-Cola 20oz',                  price: 2.25, category: 'soda',         upc: '049000028935', available: true },
  { id: 'pepsi-20oz',        name: 'Pepsi 20oz',                      price: 2.25, category: 'soda',         upc: '012000001765', available: true },
  { id: 'mtn-dew-20oz',      name: 'Mountain Dew 20oz',               price: 2.25, category: 'soda',         upc: '012000007569', available: true },
  { id: 'sprite-20oz',       name: 'Sprite 20oz',                     price: 2.25, category: 'soda',         upc: '049000028904', available: true },
  // ── Other Drinks ──
  { id: 'gatorade-fruit',    name: 'Gatorade Fruit Punch 20oz',       price: 2.50, category: 'other-drinks', upc: '052000328941', available: true },
  { id: 'gatorade-lemon',    name: 'Gatorade Lemon Lime 20oz',        price: 2.50, category: 'other-drinks', upc: '052000113101', available: true },
  { id: 'dasani-20oz',       name: 'Dasani Water 20oz',               price: 1.75, category: 'other-drinks', upc: '049000028904', available: true },
  { id: 'oj-12oz',           name: 'Minute Maid Orange Juice 12oz',   price: 2.25, category: 'other-drinks', upc: '025000048586', available: true },

  // ── Snacks ──
  { id: 'doritos-nacho',     name: "Doritos Nacho Cheese 1.75oz",     price: 1.75, category: 'chips',    upc: '028400064330', available: true },
  { id: 'doritos-cool',      name: "Doritos Cool Ranch 1.75oz",       price: 1.75, category: 'chips',    upc: '028400064361', available: true },
  { id: 'lays-classic',      name: "Lay's Classic 1.5oz",             price: 1.75, category: 'chips',    upc: '028400315943', available: true },
  { id: 'fritos',            name: 'Fritos Original 1.75oz',          price: 1.75, category: 'chips',    upc: '028400390316', available: true },
  { id: 'cheezit',           name: 'Cheez-It Original 3oz',           price: 1.75, category: 'snacks', upc: '024100106363', available: true },
  { id: 'planters',          name: 'Planters Peanuts 1.75oz',         price: 1.25, category: 'snacks', upc: '029000015524', available: true },
  { id: 'trail-mix',         name: 'Trail Mix 1.5oz',                 price: 2.00, category: 'snacks', upc: '077975070932', available: true },
  { id: 'natures-bakery',    name: "Nature's Bakery Fig Bar",         price: 1.50, category: 'snacks',   upc: '852210006139', available: true },
  { id: 'nature-valley',     name: 'Nature Valley Granola Bar',       price: 1.50, category: 'snacks',   upc: '016000275836', available: true },
  { id: 'pop-tarts',         name: 'Pop-Tarts Strawberry 2ct',        price: 1.75, category: 'snacks',   upc: '038000199813', available: true },

  // ── Candy ──
  { id: 'snickers',          name: 'Snickers 1.86oz',                 price: 1.75, category: 'candy',    upc: '040000001935', available: true },
  { id: 'reeses',            name: "Reese's Peanut Butter Cups",      price: 1.75, category: 'candy',    upc: '034000002467', available: true },
  { id: 'mms-peanut',        name: "M&M's Peanut 1.74oz",             price: 1.75, category: 'candy',    upc: '040000217336', available: true },
  { id: 'skittles',          name: 'Skittles Original 1.8oz',         price: 1.75, category: 'candy',    upc: '022000010940', available: true },
  { id: 'twix',              name: 'Twix 1.79oz',                     price: 1.75, category: 'candy',    upc: '040000001850', available: true },
  { id: 'starburst',         name: 'Starburst Original 2.07oz',       price: 1.75, category: 'candy',    upc: '022000012807', available: true },

  // ── Food ──
  { id: 'wrap-turkey',       name: 'Turkey & Swiss Wrap',             price: 5.50, category: 'food',     available: true },
  { id: 'sandwich-ham',      name: 'Ham & Cheddar Sandwich',          price: 4.75, category: 'food',     available: true },
]

// Category display metadata
export const CATEGORIES: Record<string, { label: string; icon: string }> = {
  energy:          { label: 'Energy Drinks', icon: '/Energy.png' },
  soda:            { label: 'Soda',          icon: '/Soda.png' },
  'other-drinks':  { label: 'Other Drinks',  icon: '/Other Drinks.png' },
  chips:           { label: 'Chips',         icon: '/Chips.png' },
  snacks:          { label: 'Snacks',        icon: '/Snacks.png' },
  candy:           { label: 'Candy',         icon: '/Candy.png' },
  food:            { label: 'Food',          icon: '/Food.png' },
  'ice-cream':     { label: 'Ice Cream',     icon: '/Ice Cream.png' },
}

// Which categories to show on the browse screen (ordered)
export const ACTIVE_CATEGORIES: string[] = [
  'energy', 'soda', 'other-drinks', 'ice-cream', 'chips', 'snacks', 'candy', 'food',
]
