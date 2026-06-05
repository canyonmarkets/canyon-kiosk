export type Category =
  | 'energy'
  | 'drinks'
  | 'snacks'
  | 'chips'
  | 'candy'
  | 'crackers'
  | 'food'
  | 'ice-cream'

export interface Product {
  id: string
  name: string
  price: number         // dollars (e.g. 3.25)
  category: Category
  upc?: string
  available: boolean    // false = sold out / hidden
}

export interface CartItem {
  product: Product
  qty: number
}

export interface Transaction {
  id: string
  items: CartItem[]
  subtotal: number
  tax: number
  total: number
  completedAt: string   // ISO timestamp
  machineId: string
}

export type Screen =
  | 'idle'
  | 'browse'
  | 'products'
  | 'cart'
  | 'payment'
  | 'thankyou'
  | 'admin'

export interface MachineConfig {
  machineId: string       // e.g. 'SF1'
  locationName: string    // e.g. 'Steel Fab'
  partnerName?: string    // e.g. 'Clayco Compute' (data center sites only)
  taxRate: number         // e.g. 0.091 for 9.1%
  adminPin: string        // 4-digit PIN
  theme?: string          // e.g. 'steelfab' | 'canyon' — set via ?theme= URL param
}
