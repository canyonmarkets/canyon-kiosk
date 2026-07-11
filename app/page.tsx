'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useKioskStore } from './lib/store'
import { loadMarketProducts } from './lib/loadMachineProducts'
import { supabase } from './lib/supabase'
import IdleScreen      from './components/screens/IdleScreen'
import BrowseScreen    from './components/screens/BrowseScreen'
import ProductsScreen  from './components/screens/ProductsScreen'
import CartScreen      from './components/screens/CartScreen'
import PaymentScreen   from './components/screens/PaymentScreen'
import ThankYouScreen  from './components/screens/ThankYouScreen'
import TimeoutModal    from './components/TimeoutModal'
import OfflineBanner   from './components/OfflineBanner'
import AdminPanel      from './components/AdminPanel'

const CART_IDLE_SECONDS = 20  // 20 seconds — fast turnover for high-traffic sites

export default function KioskPage() {
  const { screen, setScreen, clearCart, cart, config, setProducts, productsLoading } = useKioskStore()

  // Prevent React hydration mismatch: the SSR pre-build uses the default machineId
  // ('SF1') but every other machine reads a different URL param on the client.
  // Returning null until mounted lets the client render fresh with the correct config.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Load real products from Supabase on init.
  // On failure/empty the catalog stays EMPTY (never a demo/placeholder list —
  // demo items don't exist in the DB, so a live sale of one couldn't be
  // ingested and the price could be wrong). The refresh effect below retries
  // every minute while the catalog is empty, so a transient boot-time outage
  // self-heals without a visit to the site.
  useEffect(() => {
    if (!mounted) return
    loadMarketProducts(config.machineId)
      .then((products) => setProducts(products))
      .catch(() => setProducts([]))  // network error on first boot — clear loading spinner, retry below
  }, [mounted])

  // Idle timer (fires when customer leaves cart without paying)
  const [showTimeout, setShowTimeout] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    // Arm on ANY shopping screen — an abandoned session (even one left on the
    // products screen with items in the cart) must never carry to the next
    // customer. If the cart has items we confirm before discarding; an empty
    // browsing session just resets to the attract screen.
    const shopping = screen === 'cart' || screen === 'browse' || screen === 'products'
    if (!shopping) return
    idleTimerRef.current = setTimeout(() => {
      if (useKioskStore.getState().cart.length > 0) setShowTimeout(true)
      else setScreen('idle')
    }, CART_IDLE_SECONDS * 1000)
  }, [screen, setScreen])

  useEffect(() => { resetIdleTimer() }, [screen, cart.length, resetIdleTimer])

  const handleKeepShopping = () => { setShowTimeout(false); resetIdleTimer() }
  const handleCancelOrder  = () => { setShowTimeout(false); clearCart(); setScreen('idle') }

  // Last transaction total for thank-you screen
  const [lastTotal, setLastTotal] = useState(0)
  const handlePaymentApproved = (total: number) => {
    setLastTotal(total)
    setScreen('thankyou')
  }

  // ── Admin Panel access: tap logo area 5× ──────────────────────────────────
  const [adminTaps, setAdminTaps]     = useState(0)
  const [showPinEntry, setShowPinEntry] = useState(false)
  const [pinInput, setPinInput]       = useState('')
  const [pinError, setPinError]       = useState(false)
  const [showAdmin, setShowAdmin]     = useState(false)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLogoTap = () => {
    setAdminTaps((n) => {
      const next = n + 1
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
      tapTimerRef.current = setTimeout(() => setAdminTaps(0), 3000)
      if (next >= 5) { setAdminTaps(0); setShowPinEntry(true); setPinInput(''); setPinError(false) }
      return next
    })
  }

  const handlePinDigit = (d: string) => {
    setPinError(false)
    setPinInput((p) => {
      const next = p + d
      if (next.length === 4) {
        if (next === config.adminPin) { setShowPinEntry(false); setShowAdmin(true) }
        else { setPinError(true); return '' }
      }
      return next
    })
  }

  // ── Barcode scanner — hidden focusable DIV (no soft keyboard on Android) ──
  // A <div tabIndex> receives HID scanner keystrokes but never triggers the
  // Android virtual keyboard, unlike <input> which always does.
  const scanDivRef     = useRef<HTMLDivElement>(null)
  const barcodeBuffer  = useRef('')
  const barcodeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const scanMsgTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showScanFeedback = useCallback((text: string, ok: boolean) => {
    setScanMsg({ text, ok })
    if (scanMsgTimer.current) clearTimeout(scanMsgTimer.current)
    scanMsgTimer.current = setTimeout(() => setScanMsg(null), 2200)
  }, [])

  const refocusScanDiv = useCallback(() => {
    if (showAdmin || showPinEntry) return
    if (screen === 'payment' || screen === 'thankyou') return
    setTimeout(() => scanDivRef.current?.focus(), 50)
  }, [showAdmin, showPinEntry, screen])

  useEffect(() => { refocusScanDiv() }, [screen, showAdmin, showPinEntry, refocusScanDiv])

  const processBarcode = useCallback((raw: string) => {
    raw = raw.trim()
    if (raw.length < 4) return
    if (showAdmin || showPinEntry) return
    if (screen === 'payment' || screen === 'thankyou') return
    if (useKioskStore.getState().productsLoading) {
      showScanFeedback('Loading inventory… please try again', false)
      return
    }
    const stripLeadingZeros = (s: string) => s.replace(/^0+/, '') || s
    const normalizedRaw = stripLeadingZeros(raw)
    const products = useKioskStore.getState().products
    // Match against EITHER barcode on the product (primary UPC or the optional 2nd
    // barcode, e.g. a multipack vs. single) — both ring up the same item.
    const product = products.find((p) => {
      if (!p.available) return false
      return [p.upc, p.upc2].some((code) => {
        const stored = (code ?? '').trim()
        return stored && stripLeadingZeros(stored) === normalizedRaw
      })
    })
    if (product) {
      useKioskStore.getState().addToCart(product)
      showScanFeedback(`✓ Added: ${product.name}`, true)
      setScreen('cart')
    } else {
      showScanFeedback(`Not found: ${raw}`, false)
    }
    resetIdleTimer()
  }, [showAdmin, showPinEntry, screen, showScanFeedback, setScreen, resetIdleTimer])

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (barcodeTimer.current) { clearTimeout(barcodeTimer.current); barcodeTimer.current = null }
      processBarcode(barcodeBuffer.current)
      barcodeBuffer.current = ''
      return
    }
    if (e.key.length === 1) {
      barcodeBuffer.current += e.key
      // Fallback: process after 80ms of no new chars (scanners without Enter suffix)
      if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
      barcodeTimer.current = setTimeout(() => {
        processBarcode(barcodeBuffer.current)
        barcodeBuffer.current = ''
        barcodeTimer.current = null
      }, 80)
    }
  }

  // ── Crash recovery: reload on unhandled error ─────────────────────────────
  // IMPORTANT: never reload while the customer is actively shopping.
  // Errors during Supabase loading, chunk fetches, etc. should not kick
  // someone out of the middle of a transaction.
  useEffect(() => {
    const safeToReload = () => {
      const state = useKioskStore.getState()
      if (state.cart.length > 0) return false                          // customer has items
      if (state.screen === 'payment' || state.screen === 'thankyou') return false
      return true
    }
    // IMPORTANT: check safeToReload() INSIDE the timeout callback, not when the error first
    // fires. Errors often happen during boot (before any scan). If we checked at fire-time,
    // the cart would be empty → reload gets scheduled → customer scans → cart fills → but the
    // reload fires 4 s later anyway because the check already passed. Checking at execution
    // time lets a scan that happens within those 4 seconds cancel the pending reload.
    const onError     = () => { setTimeout(() => { if (safeToReload()) window.location.reload() }, 4000) }
    const onUnhandled = () => { setTimeout(() => { if (safeToReload()) window.location.reload() }, 4000) }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onUnhandled) }
  }, [])

  // ── Product refresh ────────────────────────────────────────────────────────
  // Three triggers: 5-min interval, page becoming visible (screen wake/unlock),
  // and window regaining focus (EloView returning from system UI).
  // Android kiosks throttle setInterval in low-power/idle states, so the
  // visibility + focus listeners are the reliable fallback.
  useEffect(() => {
    let lastRefresh = 0
    const COOLDOWN = 60 * 1000  // don't hammer Supabase if multiple events fire at once

    const refresh = () => {
      const now = Date.now()
      if (now - lastRefresh < COOLDOWN) return
      lastRefresh = now
      loadMarketProducts(config.machineId)
        .then((products) => { if (products.length > 0) setProducts(products) })
        .catch(() => { /* offline — keep current catalog */ })
    }

    const interval = setInterval(refresh, 5 * 60 * 1000)

    // Fast retry while the catalog is EMPTY (boot-time Supabase outage or a
    // failed first load) — an empty storefront can't sell anything, so keep
    // trying every minute until products appear. COOLDOWN still applies.
    const emptyRetry = setInterval(() => {
      if (useKioskStore.getState().products.length === 0) refresh()
    }, 61 * 1000)

    // Fire on screen wake / tab visibility restored
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    // Fire when EloView browser window regains focus
    const onFocus = () => refresh()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(interval)
      clearInterval(emptyRetry)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // ── Instant catalog sync (dash "Sync Kiosks" button) ──────────────────────
  // vending-dash broadcasts on the 'catalog-sync' Realtime channel when Jeff
  // taps Sync Kiosks — the kiosk refetches immediately instead of waiting for
  // the 5-min poll, then acks back with its machine code + item count so the
  // dash can show a per-kiosk ✓. Same empty-catalog guard as the poll refresh:
  // a failed/empty fetch never wipes a working catalog.
  useEffect(() => {
    const channel = supabase.channel('catalog-sync')
    channel.on('broadcast', { event: 'sync' }, () => {
      loadMarketProducts(config.machineId)
        .then((products) => {
          if (products.length > 0) setProducts(products)
          channel.send({
            type: 'broadcast',
            event: 'synced',
            payload: { machine: config.machineId, count: products.length },
          })
        })
        .catch(() => { /* offline — dash shows "no reply", poll catches up later */ })
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Heartbeat: ping every minute ─────────────────────────────────────────
  // The dashboard (and the email alert function) flag a machine OFFLINE when
  // last_seen is older than 5 minutes — so the ping interval must be well
  // inside that window. A 5-min interval made healthy kiosks flap offline on
  // any jitter or one throttled tick.
  useEffect(() => {
    const sendHeartbeat = async () => {
      // Write straight to Supabase. (The kiosk is a static export — `/api/heartbeat`
      // does not exist on the deployed site, so the old fetch silently 404'd and no
      // heartbeat was ever recorded.) machine_heartbeats allows this write; PK = machine_code.
      try {
        await supabase.from('machine_heartbeats').upsert(
          {
            machine_code: config.machineId,
            last_seen: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'machine_code' },
        )
      } catch { /* offline — heartbeat monitor will notice the gap */ }
    }
    sendHeartbeat()
    const interval = setInterval(sendHeartbeat, 60 * 1000)

    // Belt-and-suspenders against Android/WebView timer throttling: when the screen
    // sleeps or the app is backgrounded, setInterval can freeze and the ping stops —
    // which flags the kiosk OFFLINE even though Wi-Fi is fine. Fire an immediate
    // heartbeat whenever the page becomes visible or regains focus, so any wake
    // re-checks in instantly. Mirrors the product-refresh wiring above.
    const onVisibility = () => { if (document.visibilityState === 'visible') sendHeartbeat() }
    const onFocus = () => sendHeartbeat()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [config.machineId])

  // ── Screen wake lock: keep the tablet awake 24/7 ─────────────────────────
  // Sleep is fatal here: once the screen turns off the page becomes `hidden`,
  // which (a) releases any wake lock and (b) makes Chromium throttle/freeze the
  // heartbeat interval above — so the kiosk silently reads OFFLINE even with
  // Wi-Fi up, then the access point drops the now-idle client. This holds the
  // screen on from inside the app as a backup to Fully Kiosk's "Keep Screen On".
  // The OS auto-releases the lock whenever the page hides (screen off), so we
  // re-acquire on every visibility restore.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      if (sentinel || document.visibilityState !== 'visible') return
      try {
        sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) { void sentinel.release(); sentinel = null; return }
        // Fired when the OS releases it (screen off / page hidden) — clear our
        // handle so the visibility listener re-acquires on the next wake.
        sentinel.addEventListener('release', () => { sentinel = null })
      } catch { /* insecure context, low battery, or OS denial — Fully's setting is the primary guard */ }
    }

    const onVisibility = () => { if (document.visibilityState === 'visible') acquire() }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel) { void sentinel.release(); sentinel = null }
    }
  }, [])

  if (!mounted) return <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a' }} />

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onPointerDown={resetIdleTimer}
    >
      <OfflineBanner />

      {/* All screens — active class controls visibility */}
      <div style={{ position: 'absolute', inset: 0 }}>

        {/* Idle */}
        <div className={`kiosk-screen${screen === 'idle' ? ' active' : ''}`} style={{ alignItems: 'center', justifyContent: 'center', gap: 0, padding: '24px 0 20px' }}>
          {/* Invisible tap zone on logo for admin access */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: 120, height: 120, zIndex: 10, cursor: 'default' }} onClick={handleLogoTap} />
          <IdleScreen />
        </div>

        <div className={`kiosk-screen${screen === 'browse' ? ' active' : ''}`}>
          <BrowseScreen />
        </div>

        <div className={`kiosk-screen${screen === 'products' ? ' active' : ''}`}>
          <ProductsScreen />
        </div>

        <div className={`kiosk-screen${screen === 'cart' ? ' active' : ''}`}>
          <CartScreen />
        </div>

        <div className={`kiosk-screen${screen === 'payment' ? ' active' : ''}`}>
          <PaymentScreen onApproved={handlePaymentApproved} isActive={screen === 'payment'} />
        </div>

        <div className={`kiosk-screen${screen === 'thankyou' ? ' active' : ''}`}>
          <ThankYouScreen lastTotal={lastTotal} isActive={screen === 'thankyou'} />
        </div>
      </div>

      {/* Idle timeout modal */}
      <TimeoutModal
        visible={showTimeout && (screen === 'cart' || screen === 'browse' || screen === 'products')}
        onKeep={handleKeepShopping}
        onCancel={handleCancelOrder}
      />

      {/* PIN entry overlay */}
      {showPinEntry && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 800,
          background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', border: '2px solid var(--ember)', borderRadius: 20,
            padding: '40px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: 360,
          }}>
            <div style={{ fontFamily: 'var(--font-brand)', fontSize: 24, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text)' }}>
              Admin Access
            </div>
            {/* PIN dots */}
            <div style={{ display: 'flex', gap: 14 }}>
              {[0,1,2,3].map((i) => (
                <div key={i} style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: i < pinInput.length ? 'var(--ember)' : 'var(--border)',
                  transition: 'background 0.15s',
                }} />
              ))}
            </div>
            {pinError && <div style={{ color: 'var(--red)', fontSize: 14, fontWeight: 600 }}>Incorrect PIN — try again</div>}
            {/* Numpad */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, width: '100%' }}>
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d) => (
                <button
                  key={d}
                  onClick={() => d === '⌫' ? setPinInput((p) => p.slice(0,-1)) : d ? handlePinDigit(d) : null}
                  disabled={!d}
                  style={{
                    height: 60, borderRadius: 10, fontSize: 22, fontWeight: 700,
                    background: d ? 'var(--surface-2)' : 'transparent',
                    border: d ? '1px solid var(--border)' : 'none',
                    color: d ? 'var(--text)' : 'transparent', cursor: d ? 'pointer' : 'default',
                    visibility: d === '' ? 'hidden' : 'visible',
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
            <button onClick={() => setShowPinEntry(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hidden focusable div — captures HID scanner keystrokes without triggering Android soft keyboard */}
      <div
        ref={scanDivRef}
        onKeyDown={handleScanKeyDown}
        onBlur={refocusScanDiv}
        tabIndex={0}
        aria-hidden="true"
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, overflow: 'hidden', outline: 'none' }}
      />

      {/* Admin panel */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      {/* Barcode scan feedback toast */}
      {scanMsg && (
        <div style={{
          position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          zIndex: 700, pointerEvents: 'none',
          background: scanMsg.ok ? '#052e16' : '#450a0a',
          border: `2px solid ${scanMsg.ok ? 'var(--green)' : 'var(--red)'}`,
          color: scanMsg.ok ? '#86efac' : '#fca5a5',
          fontSize: 18, fontWeight: 700, padding: '16px 32px', borderRadius: 14,
          whiteSpace: 'nowrap', animation: 'fadeInUp 0.2s ease',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          {scanMsg.text}
        </div>
      )}
    </div>
  )
}
