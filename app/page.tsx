'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useKioskStore } from './lib/store'
import { loadMarketProducts } from './lib/loadMachineProducts'
import { supabase } from './lib/supabase'
import { initTelemetry, logEvent, logOfflineTick, memorySnapshot, uptimeMinutes } from './lib/telemetry'
import IdleScreen      from './components/screens/IdleScreen'
import OfflineScreen   from './components/screens/OfflineScreen'
import ReaderOfflineScreen from './components/screens/ReaderOfflineScreen'
import BrowseScreen    from './components/screens/BrowseScreen'
import ProductsScreen  from './components/screens/ProductsScreen'
import CartScreen      from './components/screens/CartScreen'
import PaymentScreen   from './components/screens/PaymentScreen'
import ThankYouScreen  from './components/screens/ThankYouScreen'
import TimeoutModal    from './components/TimeoutModal'
import OfflineBanner   from './components/OfflineBanner'
import AdminPanel      from './components/AdminPanel'

const CART_IDLE_SECONDS = 20  // 20 seconds — fast turnover for high-traffic sites

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function KioskPage() {
  const { screen, setScreen, clearCart, cart, config, setProducts, productsLoading, products, offline, browserOffline, backendStale, readerOffline } = useKioskStore()

  // ?offline=1 forces the offline state — for testing the offline screen on a
  // dev box or a live kiosk without actually cutting its network.
  const [simOffline] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('offline'))

  // ?stale=1 reproduces the MB1 (2026-09-07) failure exactly — catalog loaded
  // and cached, backend unreachable. ?offline=1 CANNOT reproduce it, because it
  // empties the catalog and so trips the old gate; the whole six-hour outage
  // happened in the gap between those two states.
  const [simStale] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stale'))

  // ?readeroff=1 shows the card-reader-offline state with the tablet healthy,
  // the MB1 2026-10-09 failure, without unplugging a real reader.
  const [simReaderOff] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('readeroff'))

  // Prevent React hydration mismatch: the SSR pre-build uses the default machineId
  // ('SF1') but every other machine reads a different URL param on the client.
  // Returning null until mounted lets the client render fresh with the correct config.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Breadcrumb telemetry: boot marker + global error/rejection hooks → kiosk_events.
  // Waits for mount so the machine code comes from the real URL param, not the
  // SF1 SSR default.
  useEffect(() => {
    if (!mounted) return
    return initTelemetry(config.machineId)
  }, [mounted, config.machineId])

  // Load real products from Supabase on init.
  // On failure/empty the catalog stays EMPTY (never a demo/placeholder list —
  // demo items don't exist in the DB, so a live sale of one couldn't be
  // ingested and the price could be wrong). The refresh effect below retries
  // every minute while the catalog is empty, so a transient boot-time outage
  // self-heals without a visit to the site.
  useEffect(() => {
    if (!mounted) return
    if (simOffline) {
      setProducts([])
      useKioskStore.getState().reportNetFailure('simulated outage (?offline=1)')
      return
    }
    loadMarketProducts(config.machineId)
      .then((products) => {
        setProducts(products)
        useKioskStore.getState().clearNetFailure()
        useKioskStore.getState().noteServerContact()
      })
      .catch((err) => {
        // network error on first boot — clear loading spinner; the empty-catalog
        // retry below keeps trying and the offline screen shows meanwhile
        setProducts([])
        useKioskStore.getState().reportNetFailure(errMsg(err))
      })
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
    // Nothing scanned can be paid for, so don't put it in a cart. Telling the
    // shopper before they're holding a full cart also takes away the moment
    // where walking off with it starts to look like the easy option.
    const { readerOffline: readerDown, backendStale: serverDown } = useKioskStore.getState()
    if (readerDown || serverDown) {
      showScanFeedback('Card payments are unavailable right now', false)
      return
    }
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
      if (simOffline) {
        useKioskStore.getState().reportNetFailure('simulated outage (?offline=1)')
        return
      }
      loadMarketProducts(config.machineId)
        .then((products) => {
          if (products.length > 0) setProducts(products)
          if (simStale) return
          useKioskStore.getState().clearNetFailure()
          useKioskStore.getState().noteServerContact()
        })
        .catch((err) => {
          // offline — keep current catalog; track the failure so the offline
          // screen (empty catalog) or banner (loaded catalog) can show
          useKioskStore.getState().reportNetFailure(errMsg(err))
        })
    }

    const interval = setInterval(refresh, 5 * 60 * 1000)

    // Browser-level connectivity signals: 'offline' fires the instant Wi-Fi
    // drops (faster + more certain than waiting for a fetch to fail); 'online'
    // triggers an immediate verify-fetch instead of waiting out the poll.
    const onBrowserOffline = () => {
      useKioskStore.getState().setBrowserOffline(true)
      useKioskStore.getState().reportNetFailure('device reports no network connection')
    }
    const onBrowserOnline = () => {
      useKioskStore.getState().setBrowserOffline(false)
      lastRefresh = 0
      refresh()
    }
    window.addEventListener('offline', onBrowserOffline)
    window.addEventListener('online', onBrowserOnline)
    if (typeof navigator !== 'undefined' && !navigator.onLine) onBrowserOffline()

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
      window.removeEventListener('offline', onBrowserOffline)
      window.removeEventListener('online', onBrowserOnline)
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
    // Remote heap flush: broadcast {event:'reload', payload:{machine}} on this
    // channel (payload.machine = code or 'ALL') and the kiosk reloads its own
    // page — dumps the WebView JS heap with zero power/Wi-Fi interruption
    // (unlike the device reboots that stranded a call-center kiosk). Refuses
    // while a customer is mid-session; safe to fire from home instead of
    // driving to the site.
    channel.on('broadcast', { event: 'reload' }, ({ payload }) => {
      const target = payload?.machine
      if (target !== 'ALL' && target !== config.machineId) return
      const { screen: cur, cart: curCart } = useKioskStore.getState()
      if (cur !== 'idle' || curCart.length > 0) {
        logEvent(config.machineId, 'reload_skipped', `remote reload refused: screen=${cur}, cart=${curCart.length}`)
        return
      }
      logEvent(config.machineId, 'self_reload', 'remote reload command')
      setTimeout(() => window.location.reload(), 1500)  // let the breadcrumb land first
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Scheduled self-reload: dump the JS heap without reboot or Wi-Fi drop ──
  // The suspected SF2 freeze cause is heap growth over days of 24/7 uptime.
  // Reloading the page discards the entire heap while the tablet, Android,
  // Fully, and the Wi-Fi connection stay untouched. Fires only on the idle
  // screen with an empty cart, so a customer can never be interrupted; a busy
  // kiosk just retries a minute later.
  //
  // Primary schedule: nightly during the 2–4 AM tablet-local window (Steel
  // Fab's only dark window — 24hr shifts elsewhere in the day). Fallback: any
  // time uptime passes 20h, in case the window was missed (kiosk busy, clock
  // wrong). Uptime >60 min inside the window prevents a reload loop.
  useEffect(() => {
    const FALLBACK_UPTIME_MIN = 20 * 60
    const iv = setInterval(() => {
      const { screen: cur, cart: curCart } = useKioskStore.getState()
      if (cur !== 'idle' || curCart.length > 0) return
      const hour = new Date().getHours()
      const inNightWindow = hour >= 2 && hour < 4
      const due = inNightWindow ? uptimeMinutes() >= 60 : uptimeMinutes() >= FALLBACK_UPTIME_MIN
      if (!due) return
      logEvent(config.machineId, 'self_reload',
        `${inNightWindow ? 'nightly' : 'fallback'} heap flush at uptime ${uptimeMinutes()} min`)
      setTimeout(() => window.location.reload(), 1500)
    }, 60 * 1000)
    return () => clearInterval(iv)
  }, [config.machineId])

  // ── Heartbeat: ping every minute ─────────────────────────────────────────
  // The dashboard (and the email alert function) flag a machine OFFLINE when
  // last_seen is older than 5 minutes — so the ping interval must be well
  // inside that window. A 5-min interval made healthy kiosks flap offline on
  // any jitter or one throttled tick.
  useEffect(() => {
    // Card reader status rides the heartbeat clock. The kiosk can't ask Stripe
    // itself (no secret key on a public tablet), so it reads the snapshot the
    // dash's stripe-reader-alert function writes every 5 minutes. Any read
    // failure leaves the current state alone; the store fails open on a
    // missing or stale snapshot.
    const checkReader = async () => {
      if (simReaderOff) { useKioskStore.getState().markReaderOffline(); return }
      try {
        const { data, error } = await supabase
          .from('app_config').select('value').eq('key', 'readerStatusLast').maybeSingle()
        if (error) return
        useKioskStore.getState().applyReaderSnapshot(data?.value, config.machineId)
      } catch { /* network blip, next heartbeat retries */ }
    }

    const sendHeartbeat = async () => {
      // Write straight to Supabase. (The kiosk is a static export — `/api/heartbeat`
      // does not exist on the deployed site, so the old fetch silently 404'd and no
      // heartbeat was ever recorded.) machine_heartbeats allows this write; PK = machine_code.
      try {
        // Memory + uptime ride along on every heartbeat so a WebView leak shows
        // up as a climbing mem_used_mb curve BEFORE the freeze (SF2, Aug 1 2026).
        await supabase.from('machine_heartbeats').upsert(
          {
            machine_code: config.machineId,
            last_seen: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            uptime_min: uptimeMinutes(),
            ...memorySnapshot(),
          },
          { onConflict: 'machine_code' },
        )
        // Heartbeats are upserts — each overwrites the last, so the freeze wipes
        // the evidence. Warn into kiosk_events (append-only) when the heap is
        // within 80% of the WebView's limit: that trail survives the crash.
        // A completed upsert is the strongest proof the backend is reachable,
        // and at 60s it's our fastest one — this is the clock the offline
        // screen and the checkout gate both run on.
        if (!simStale) useKioskStore.getState().noteServerContact()
        await checkReader()
        const mem = memorySnapshot()
        if (mem && mem.mem_limit_mb > 0 && mem.mem_used_mb / mem.mem_limit_mb > 0.8) {
          logEvent(config.machineId, 'memory_high', `${mem.mem_used_mb}/${mem.mem_limit_mb} MB`)
        }
      } catch { /* offline — the staleness ticker below surfaces it to the shopper */ }
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

  // ── Backend staleness watch ───────────────────────────────────────────────
  // Turns "we haven't reached the server in a while" into something the shopper
  // can actually SEE. MB1 (2026-09-07) is why this exists: with a cached catalog
  // and navigator.onLine stuck true on a dead uplink, the kiosk spent six hours
  // walking residents all the way to a 20-second payment timeout and then
  // resetting to a healthy-looking attract screen.
  //
  // It also drops an offline_tick breadcrumb every 5 min while unreachable.
  // Those queue to localStorage and flush on the next boot, and the timestamp of
  // the LAST one is the whole ballgame: ticks that run to the moment power was
  // cut mean the app was alive on a dead network; ticks that stop dead hours
  // earlier mean the WebView froze. Today we cannot tell those apart.
  useEffect(() => {
    if (!mounted) return
    const OFFLINE_TICK_MS = 5 * 60 * 1000
    let staleSince = 0
    let lastTick = 0

    const check = () => {
      if (simStale) useKioskStore.getState().markBackendUnreachable()
      useKioskStore.getState().evaluateStaleness()
      const { backendStale: stale, offline: off } = useKioskStore.getState()
      const now = Date.now()

      if (stale && !staleSince) {
        staleSince = now
        lastTick = now
        logOfflineTick(config.machineId, { phase: 'went_stale', lastError: off?.lastError ?? null })
      } else if (stale && now - lastTick >= OFFLINE_TICK_MS) {
        lastTick = now
        logOfflineTick(config.machineId, {
          phase: 'still_down',
          offline_sec: Math.round((now - staleSince) / 1000),
          attempts: off?.attempts ?? null,
        })
      } else if (!stale && staleSince) {
        // This one can go over the wire — the backend is back.
        logEvent(config.machineId, 'net_recovered',
          `backend reachable again after ${Math.round((now - staleSince) / 1000)}s unreachable`)
        staleSince = 0
      }
    }

    check()
    const iv = setInterval(check, 15 * 1000)
    return () => clearInterval(iv)
  }, [mounted, config.machineId, simStale])

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

        {/* Idle — replaced by the offline screen when the kiosk can't operate:
            either the catalog never loaded (Supabase unreachable at boot, the
            2026-07-22 Steel Fab failure mode) or the device itself reports no
            network (can't charge cards). A loaded catalog with a transient
            fetch blip keeps the normal idle screen — the kiosk can still sell. */}
        <div className={`kiosk-screen${screen === 'idle' ? ' active' : ''}`} style={{ alignItems: 'center', justifyContent: 'center', gap: 0, padding: '24px 0 20px' }}>
          {/* Invisible tap zone on logo for admin access */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: 120, height: 120, zIndex: 10, cursor: 'default' }} onClick={handleLogoTap} />
          {backendStale || (offline && (products.length === 0 || browserOffline))
            ? <OfflineScreen />
            : readerOffline
              ? <ReaderOfflineScreen />
              : <IdleScreen />}
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
