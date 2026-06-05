'use client'
import { create } from 'zustand'
import type { CartItem, Product, Screen, Transaction, MachineConfig } from '../types'
import { PRODUCTS } from './products'
import { loadConfig, saveConfig, CONFIG_STORAGE_KEY } from './config'

interface KioskStore {
  // Screen
  screen: Screen
  activeCategory: string | null
  setScreen: (s: Screen) => void
  setActiveCategory: (cat: string | null) => void

  // Cart
  cart: CartItem[]
  addToCart: (product: Product) => void
  removeFromCart: (productId: string) => void
  changeQty: (productId: string, delta: number) => void
  clearCart: () => void
  cartTotal: () => number
  cartSubtotal: () => number
  cartTax: () => number
  cartCount: () => number

  // Products (loaded from Supabase, editable in admin)
  products: Product[]
  productsLoading: boolean
  setProducts: (products: Product[]) => void
  updateProductPrice: (id: string, price: number) => void
  toggleProductAvailable: (id: string) => void

  // Transactions (today)
  transactions: Transaction[]
  addTransaction: (tx: Transaction) => void

  // Config
  config: MachineConfig
  updateConfig: (config: MachineConfig) => void
}

export const useKioskStore = create<KioskStore>()((set, get) => ({
  screen: 'idle',
  activeCategory: null,
  setScreen: (screen) => set({ screen }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),

  cart: [],
  addToCart: (product) => set((s) => {
    const existing = s.cart.find((i) => i.product.id === product.id)
    if (existing) {
      return { cart: s.cart.map((i) => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i) }
    }
    return { cart: [...s.cart, { product, qty: 1 }] }
  }),
  removeFromCart: (productId) => set((s) => ({ cart: s.cart.filter((i) => i.product.id !== productId) })),
  changeQty: (productId, delta) => set((s) => {
    const updated = s.cart.map((i) => i.product.id === productId ? { ...i, qty: i.qty + delta } : i)
    return { cart: updated.filter((i) => i.qty > 0) }
  }),
  clearCart: () => set({ cart: [] }),
  cartSubtotal: () => get().cart.reduce((sum, i) => sum + i.product.price * i.qty, 0),
  cartTax: () => {
    const sub = get().cartSubtotal()
    return sub * get().config.taxRate
  },
  cartTotal: () => get().cartSubtotal() + get().cartTax(),
  cartCount: () => get().cart.reduce((sum, i) => sum + i.qty, 0),

  products: PRODUCTS,
  productsLoading: true,
  setProducts: (products) => set({ products, productsLoading: false }),
  updateProductPrice: (id, price) => set((s) => ({
    products: s.products.map((p) => p.id === id ? { ...p, price } : p),
  })),
  toggleProductAvailable: (id) => set((s) => ({
    products: s.products.map((p) => p.id === id ? { ...p, available: !p.available } : p),
  })),

  transactions: [],
  addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions] })),

  config: typeof window !== 'undefined' ? loadConfig() : {
    machineId: 'SF1', locationName: 'Steel Fab', taxRate: 0.091, adminPin: '1234',
  },
  updateConfig: (config) => {
    saveConfig(config)
    set({ config })
  },
}))
