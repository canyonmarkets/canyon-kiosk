'use client'
import { create } from 'zustand'
import type { CartItem, Product, Screen, Transaction, MachineConfig } from '../types'
import { loadConfig, saveConfig, CONFIG_STORAGE_KEY } from './config'

// Sanity cap per line item — prevents a runaway "+" tap loop (stuck touch panel,
// kids mashing the button) from building an absurd charge.
const MAX_QTY_PER_ITEM = 99

// Network-outage state driving the full-screen offline display. `since` is the
// first failure of the current outage (survives across retries); each failed
// retry bumps attempts/lastAttemptAt so the screen's countdown stays honest.
export interface OfflineState {
  since: number
  attempts: number
  lastAttemptAt: number
  lastError: string
}

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

  // Network outage tracking (drives OfflineScreen)
  offline: OfflineState | null
  browserOffline: boolean
  reportNetFailure: (msg: string) => void
  clearNetFailure: () => void
  setBrowserOffline: (down: boolean) => void

  // Backend reachability (drives OfflineScreen + the checkout gate).
  // MB1, 2026-09-07: the kiosk sat for 6h18m showing a perfect, browsable
  // storefront it could not take a payment on, because the old offline gate
  // only fired on an EMPTY catalog or navigator.onLine — and MB1 had 242
  // products cached in memory while Android happily reported onLine:true on a
  // dead uplink. Reachability has to be judged by "did we actually round-trip
  // to the server recently", not by what we happen to be holding in RAM.
  lastServerContactAt: number
  backendStale: boolean
  noteServerContact: () => void
  evaluateStaleness: () => void
  markBackendUnreachable: () => void

  // Card reader reachability (drives ReaderOfflineScreen + the checkout gate).
  // MB1, 2026-10-09: the tablet was healthy all morning while its WisePOS E sat
  // off Wi-Fi, so four residents filled a cart and only learned at Pay that the
  // kiosk couldn't take a card. The reader's status comes from the dash's
  // stripe-reader-alert function (app_config.readerStatusLast, every 5 min).
  readerOffline: boolean
  readerOfflineSince: number | null
  readerOfflineDetectedAt: number
  applyReaderSnapshot: (snapshot: unknown, machineCode: string) => void
  markReaderOffline: () => void
}

export interface ReaderSnapshot {
  at: string
  readers: { code: string; status: string; last_seen_at?: number | null }[]
}

// The snapshot is rewritten every 5 minutes. Older than this means the alert
// function itself has stopped, and a dead monitor must never lock a working
// kiosk out of selling, so we fail OPEN and let the shopper try.
export const READER_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000
const READER_REFUSAL_HOLD_MS = 5 * 60 * 1000

// A card cannot be charged without the server, so the shopper must be told the
// moment we're confident it's gone. The heartbeat runs every 60s, so three
// consecutive misses is a real outage rather than one throttled tick.
export const BACKEND_STALE_MS = 3 * 60 * 1000

export const useKioskStore = create<KioskStore>()((set, get) => ({
  screen: 'idle',
  activeCategory: null,
  setScreen: (screen) => set({ screen }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),

  cart: [],
  addToCart: (product) => set((s) => {
    const existing = s.cart.find((i) => i.product.id === product.id)
    if (existing) {
      return { cart: s.cart.map((i) => i.product.id === product.id ? { ...i, qty: Math.min(i.qty + 1, MAX_QTY_PER_ITEM) } : i) }
    }
    return { cart: [...s.cart, { product, qty: 1 }] }
  }),
  removeFromCart: (productId) => set((s) => ({ cart: s.cart.filter((i) => i.product.id !== productId) })),
  changeQty: (productId, delta) => set((s) => {
    const updated = s.cart.map((i) => i.product.id === productId ? { ...i, qty: Math.min(i.qty + delta, MAX_QTY_PER_ITEM) } : i)
    return { cart: updated.filter((i) => i.qty > 0) }
  }),
  clearCart: () => set({ cart: [] }),
  cartSubtotal: () => get().cart.reduce((sum, i) => sum + i.product.price * i.qty, 0),
  cartTax: () => {
    // Round to whole cents so the on-screen Subtotal + Tax always equals the
    // Total the card is charged (raw float tax could display a penny off).
    const sub = get().cartSubtotal()
    return Math.round(sub * get().config.taxRate * 100) / 100
  },
  cartTotal: () => get().cartSubtotal() + get().cartTax(),
  cartCount: () => get().cart.reduce((sum, i) => sum + i.qty, 0),

  // Starts EMPTY — the real catalog loads from Supabase on boot. A live kiosk
  // must never sell from a placeholder list: demo items don't exist in the DB,
  // so their sales couldn't be ingested and prices could be wrong.
  products: [],
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

  offline: null,
  browserOffline: false,
  reportNetFailure: (msg) => set((s) => ({
    offline: {
      since: s.offline?.since ?? Date.now(),
      attempts: (s.offline?.attempts ?? 0) + 1,
      lastAttemptAt: Date.now(),
      lastError: msg,
    },
  })),
  clearNetFailure: () => set({ offline: null }),
  setBrowserOffline: (browserOffline) => set({ browserOffline }),

  lastServerContactAt: Date.now(),
  backendStale: false,
  // Called on EVERY successful server round-trip (heartbeat, catalog refresh,
  // charge). The heartbeat is the real clock here: at 60s it's the only call
  // frequent enough to notice an outage before a shopper does.
  noteServerContact: () => set((s) =>
    // Recovering clears the outage record immediately — waiting on the 5-minute
    // catalog refresh to call clearNetFailure would strand the offline screen up
    // for minutes after the kiosk could sell again.
    s.backendStale
      ? { lastServerContactAt: Date.now(), backendStale: false, offline: null }
      : { lastServerContactAt: Date.now() }),
  evaluateStaleness: () => set((s) => {
    const stale = Date.now() - s.lastServerContactAt > BACKEND_STALE_MS
    if (stale === s.backendStale) return {}
    if (!stale) return { backendStale: false }
    // Going stale has to populate `offline` too: OfflineScreen renders from that
    // record and bails to null without it. `since` is the last time we genuinely
    // reached the server, which is exactly what its "offline since" line means.
    return {
      backendStale: true,
      offline: s.offline ?? {
        since: s.lastServerContactAt,
        attempts: 1,
        lastAttemptAt: Date.now(),
        lastError: 'no response from the server',
      },
    }
  }),
  // A charge request that never reached the server is proof, not a hint — don't
  // make the next shopper wait out the 3-minute staleness window to be told.
  markBackendUnreachable: () => set((s) => ({
    lastServerContactAt: Date.now() - BACKEND_STALE_MS - 1,
    backendStale: true,
    offline: s.offline ?? {
      since: s.lastServerContactAt,
      attempts: 1,
      lastAttemptAt: Date.now(),
      lastError: 'charge request never reached the server',
    },
  })),

  readerOffline: false,
  readerOfflineSince: null,
  readerOfflineDetectedAt: 0,
  applyReaderSnapshot: (snapshot, machineCode) => set((s) => {
    const snap = snapshot as ReaderSnapshot | null | undefined
    const snapAt = snap?.at ? Date.parse(snap.at) : NaN
    const entry = Array.isArray(snap?.readers)
      ? snap.readers.find((r) => r.code?.toUpperCase() === machineCode.toUpperCase())
      : undefined
    const clear = { readerOffline: false, readerOfflineSince: null, readerOfflineDetectedAt: 0 }
    // Missing, stale, or no row for this machine (cash-only or a tenant
    // without the monitor): fail open, but give a fresh charge refusal a few
    // minutes first so the very next shopper isn't walked into the same wall.
    if (!entry || !Number.isFinite(snapAt) || Date.now() - snapAt > READER_SNAPSHOT_MAX_AGE_MS) {
      if (!s.readerOffline) return {}
      return Date.now() - s.readerOfflineDetectedAt < READER_REFUSAL_HOLD_MS ? {} : clear
    }
    if (entry.status === 'offline') {
      if (s.readerOffline) return {}
      return {
        readerOffline: true,
        readerOfflineSince: entry.last_seen_at ?? Date.now(),
        readerOfflineDetectedAt: Date.now(),
      }
    }
    // A charge that Stripe refused as reader-offline is newer evidence than a
    // snapshot taken before it, so only a snapshot from AFTER that refusal can
    // clear it. Without this the screen would flicker off until the next run.
    if (s.readerOffline && snapAt < s.readerOfflineDetectedAt) return {}
    return s.readerOffline ? clear : {}
  }),
  markReaderOffline: () => set((s) => ({
    readerOffline: true,
    readerOfflineSince: s.readerOfflineSince ?? Date.now(),
    readerOfflineDetectedAt: Date.now(),
  })),
}))
