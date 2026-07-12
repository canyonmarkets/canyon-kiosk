'use client'
import { useEffect, useRef, useState } from 'react'
import { useKioskStore } from '../../lib/store'

const PAYMENT_TIMEOUT_SEC = 90
const POLL_INTERVAL_MS = 2500
// If the charge edge function never answers, abort — a hung request must not
// strand the kiosk on "Sending to terminal…" forever (worst case on a dead network).
const CHARGE_CONNECT_TIMEOUT_MS = 20000
// If the payment errored and nobody taps Retry/Cancel, self-recover to the cart
// (the cart's own idle timer then returns the kiosk to the attract screen).
const ERROR_RETURN_SEC = 45
const SUPABASE_URL = 'https://zgmxmficzvlpzkosdcnx.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_MUAaPltQkyDFsR0NvLTikQ_gY_pfJFy'

type PayStatus = 'idle' | 'sending' | 'waiting' | 'approved' | 'declined' | 'timeout' | 'error'

export default function PaymentScreen({ onApproved, isActive }: { onApproved: (total: number) => void; isActive: boolean }) {
  const { setScreen, cartTotal, cartSubtotal, cartTax, cart, config, addTransaction, clearCart } = useKioskStore()
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const refIdRef   = useRef<string | null>(null)
  const approvedRef = useRef(false)  // guards handleApproved from double-firing
  // (F12) Cart snapshot taken once at Pay time so the charged amount, the bridge
  // (kiosk_sales) row, and the recorded transaction can never disagree even if a
  // barcode scan mutates the live cart between Pay and render.
  const snapshotRef = useRef<{ subtotal: number; tax: number; total: number; items: typeof cart } | null>(null)
  const [payStatus, setPayStatus] = useState<PayStatus>('idle')
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null)
  const total = cartTotal()

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  // (F4/F5) Disarm the reader for a specific reference — best-effort, with one delayed
  // retry to catch a reader the server armed just AFTER our first cancel (a client
  // abort/timeout can race ahead of the server presenting the PaymentIntent). Safe to
  // fire for a stale reference: charge-cancel (F6) only clears the reader when THAT
  // reference's PaymentIntent is the one currently on it.
  const cancelCharge = (ref: string) => {
    const send = () => fetch(`${SUPABASE_URL}/functions/v1/charge-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ referenceId: ref, machineId: config.machineId }),
    }).catch(() => { /* best-effort */ })
    send()
    setTimeout(send, 3000)
  }

  const handleApproved = () => {
    // Two slow overlapping status polls can both resolve PROCESSED and both
    // schedule this callback — the second run would record a phantom $0
    // transaction from the already-cleared cart. Run exactly once per payment.
    if (approvedRef.current) return
    approvedRef.current = true
    stopPolling()
    // (F12) Prefer the Pay-time snapshot so the receipt / recorded transaction match
    // exactly what was charged. Fall back to the live cart only if a snapshot is
    // somehow absent. clearCart() below would otherwise zero these out.
    const snap = snapshotRef.current
    const finalSubtotal = snap?.subtotal ?? cartSubtotal()
    const finalTax      = snap?.tax ?? cartTax()
    const finalTotal    = snap?.total ?? cartTotal()
    const tx = {
      id: refIdRef.current ?? `tx_${Date.now()}`,
      items: snap ? [...snap.items] : [...cart],
      subtotal: finalSubtotal,
      tax: finalTax,
      total: finalTotal,
      completedAt: new Date().toISOString(),
      machineId: config.machineId,
    }
    addTransaction(tx)
    clearCart()
    onApproved(finalTotal)
  }

  const startPayment = async () => {
    stopPolling()               // clear any stale timers (error auto-return, prior attempt)
    approvedRef.current = false
    // (F12) Snapshot the cart ONCE at Pay time. Everything downstream — amountCents,
    // the kiosk_sales bridge row, and handleApproved's recorded transaction — derives
    // from this snapshot so a late scan can't desync the charge from the record.
    const snapSubtotal = cartSubtotal()
    const snapTax = cartTax()
    const snapTotal = cartTotal()
    const items = cart.map((i) => ({
      productId: i.product.id, name: i.product.name, qty: i.qty, unitPrice: i.product.price,
    }))
    snapshotRef.current = { subtotal: snapSubtotal, tax: snapTax, total: snapTotal, items: [...cart] }
    const amountCents = Math.round(snapTotal * 100)
    const referenceId = `${config.machineId}-${Date.now()}`
    refIdRef.current = referenceId
    setPayStatus('sending')
    setErrorMsg(null)
    // Send the cart so the `charge` fn can persist a kiosk_sales row at charge time
    // (the bridge into vending-dash). subtotal is PRE-TAX — the revenue figure.
    const subtotal = snapSubtotal
    const tax = snapTax

    try {
      // Abort a hung request — on a flaky network a fetch can stall for minutes,
      // which would freeze the kiosk on the "sending" spinner with no way out.
      const controller = new AbortController()
      const connectTimer = setTimeout(() => controller.abort(), CHARGE_CONNECT_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/charge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ amountCents, referenceId, machineId: config.machineId, items, subtotal, tax }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(connectTimer)
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error ?? 'Charge request failed')
      }

      // (F2) If a cancel/timeout/unmount happened while the charge request was in
      // flight, refIdRef was cleared or replaced — bail instead of re-arming timers
      // and a poll for a session the customer already abandoned (which previously left
      // a "ghost" reader armed and could record against a later cart).
      if (refIdRef.current !== referenceId) return

      setPayStatus('waiting')

      // Timeout — if terminal never responds. Disarm the reader (with retry) so the
      // terminal clears and a late tap can't charge the next customer / leave the
      // reader busy. Mirrors the "Cancel & Return to Cart" button below.
      timerRef.current = setTimeout(() => {
        stopPolling()
        const ref = refIdRef.current
        refIdRef.current = null       // (F2) let any in-flight continuation bail
        if (ref) cancelCharge(ref)    // (F4/F5) disarm reader, best-effort + retry
        setPayStatus('timeout')
        // Track the return-to-cart nav in timerRef so stopPolling() (cancel button,
        // screen change, a new payment attempt) clears it — a stale navigation
        // firing into a NEXT payment attempt would abandon a live charge.
        timerRef.current = setTimeout(() => setScreen('cart'), 4000)
      }, PAYMENT_TIMEOUT_SEC * 1000)

      // Poll for terminal result
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(
            `${SUPABASE_URL}/functions/v1/charge-status?ref=${referenceId}`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
          )
          const { status } = await statusRes.json()
          // (F2) Bail if this payment was canceled/superseded while the poll was in
          // flight — never act on a result for a session that no longer owns the screen.
          if (refIdRef.current !== referenceId) { stopPolling(); return }
          if (status === 'PROCESSED') {
            // Stop timers NOW — otherwise the 90s timeout (or a second slow poll)
            // could still fire during the 800ms approval pause and cancel/dupe an
            // already-successful charge.
            stopPolling()
            setPayStatus('approved')
            timerRef.current = setTimeout(handleApproved, 800)
          } else if (status === 'CANCELED') {
            // Return to the cart on a decline/cancel instead of silently re-sending
            // a brand-new charge in a loop (which risked double charges and a
            // terminal left armed). The shopper re-initiates payment deliberately.
            stopPolling()
            setPayStatus('declined')
            timerRef.current = setTimeout(() => setScreen('cart'), 3500)
          }
        } catch {
          // network blip — keep polling
        }
      }, POLL_INTERVAL_MS)

    } catch (err) {
      // Log the real error for diagnostics, but never show raw technical text
      // to a customer at the terminal.
      console.error('[payment] charge failed:', err)
      stopPolling()
      // (F4) The charge fn runs server-side even if our fetch aborted (20s connect
      // timeout) — it may arm the reader AFTER we bail here. Disarm the reference (with
      // retry) so a late tap can't charge a walked-away customer or leave the reader
      // busy for the next one. Retry then mints a fresh reference on a cleared reader.
      if (refIdRef.current) cancelCharge(refIdRef.current)
      setPayStatus('error')
      setErrorMsg('We couldn’t start the payment. Please try again, or ask a team member for help.')
      // Self-recover: if nobody taps Retry/Cancel (customer walked away), return
      // to the cart so the kiosk can idle back to the attract screen on its own —
      // never leave a broken screen up waiting for manual intervention.
      timerRef.current = setTimeout(() => setScreen('cart'), ERROR_RETURN_SEC * 1000)
    }
  }

  useEffect(() => {
    if (!isActive) {
      stopPolling()
      setPayStatus('idle')
      setErrorMsg(null)
      refIdRef.current = null
      approvedRef.current = false
      snapshotRef.current = null
      return
    }
    startPayment()
    return stopPolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  const statusMessage = () => {
    switch (payStatus) {
      case 'sending':  return { text: 'Sending to terminal…', color: 'var(--ember)' }
      case 'waiting':  return { text: 'Tap your card or phone on the terminal', color: '#fff' }
      case 'approved': return { text: '✓ Payment approved!', color: '#4ade80' }
      case 'declined': return { text: 'Payment cancelled — returning to cart', color: '#f87171' }
      case 'timeout':  return { text: '⚠️ Payment timed out — returning to cart', color: '#f87171' }
      case 'error':    return { text: errorMsg ?? 'Connection error', color: '#f87171' }
      default:         return { text: '', color: '#fff' }
    }
  }

  const { text: statusText, color: statusColor } = statusMessage()

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'var(--bg)' }}>
      <div style={{ fontSize: 22, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Total Due
      </div>

      <div style={{ fontSize: 72, fontWeight: 400, color: 'var(--text)', lineHeight: 1 }}>
        ${total.toFixed(2)}
      </div>

      {/* Tap ring — pulses while waiting */}
      <div style={{
        width: 220, height: 220, borderRadius: '50%',
        border: `4px solid ${payStatus === 'approved' ? '#4ade80' : payStatus === 'declined' || payStatus === 'timeout' ? '#f87171' : 'var(--ember)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: payStatus === 'waiting' ? 'tap-pulse 1.6s ease-in-out infinite' : 'none',
        margin: '4px 0',
        transition: 'border-color 0.3s',
      }}>
        {payStatus === 'approved' ? (
          <svg width="90" height="90" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ) : (
          <svg width="152" height="96" viewBox="0 0 200 126" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="cg1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2d4a8a"/><stop offset="100%" stopColor="#0f1e3d"/>
              </linearGradient>
              <linearGradient id="chipg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d4a843"/><stop offset="100%" stopColor="#9a7025"/>
              </linearGradient>
            </defs>
            <rect width="200" height="126" rx="10" fill="url(#cg1)"/>
            <rect x="16" y="32" width="30" height="23" rx="4" fill="url(#chipg)"/>
            <line x1="16" y1="43.5" x2="46" y2="43.5" stroke="#8a6020" strokeWidth="0.8" opacity="0.8"/>
            <line x1="31" y1="32" x2="31" y2="55" stroke="#8a6020" strokeWidth="0.8" opacity="0.8"/>
            <path d="M158,26 A16,16 0 0,1 158,48" stroke="white" strokeWidth="2" fill="none" opacity="0.5"/>
            <path d="M153,21 A23,23 0 0,1 153,53" stroke="white" strokeWidth="2" fill="none" opacity="0.35"/>
            <path d="M148,16 A30,30 0 0,1 148,58" stroke="white" strokeWidth="2" fill="none" opacity="0.22"/>
            <circle cx="162" cy="107" r="13" fill="#eb001b" opacity="0.85"/>
            <circle cx="175" cy="107" r="13" fill="#f79e1b" opacity="0.75"/>
          </svg>
        )}
      </div>

      {/* Status message */}
      <div style={{ fontSize: 28, fontWeight: 400, textAlign: 'center', color: statusColor, maxWidth: 520, lineHeight: 1.3, minHeight: 70, transition: 'color 0.3s' }}>
        {statusText}
      </div>

      {payStatus === 'waiting' && (
        <div style={{ fontSize: 17, color: 'var(--ember)', textAlign: 'center', fontWeight: 500 }}>
          The payment terminal is beside this screen
        </div>
      )}

      {/* Payment method badges */}
      {(payStatus === 'waiting' || payStatus === 'sending') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          {[
            { label: '🍎 Pay', bg: '#000', color: '#fff', border: '#444' },
            { label: 'G Pay', bg: '#fff', color: '#333', border: '#ddd' },
            { label: 'Samsung Pay', bg: '#1428A0', color: '#fff', border: '#1428A0' },
          ].map(({ label, bg, color, border }) => (
            <div key={label} style={{
              padding: '10px 18px', borderRadius: 10, background: bg, color,
              border: `1px solid ${border}`, fontSize: 14, fontWeight: 600, height: 46,
              display: 'flex', alignItems: 'center',
            }}>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Error retry button */}
      {payStatus === 'error' && (
        <button className="btn-outline" onClick={startPayment} style={{ marginTop: 4, padding: '14px 44px', fontSize: 18 }}>
          Retry Payment
        </button>
      )}

      {/* (F3) Hide Cancel once approved — a tap during the 800ms approval pause would
          otherwise clear the pending handleApproved and strand a paid-for cart, inviting
          a double charge. There is nothing to cancel after approval anyway. */}
      {payStatus !== 'approved' && (
        <button className="btn-outline" onClick={() => {
          stopPolling()
          const ref = refIdRef.current
          refIdRef.current = null       // (F2) so any in-flight charge continuation bails
          if (ref) cancelCharge(ref)    // (F4/F5) disarm the reader, best-effort + retry
          setScreen('cart')
        }} style={{ marginTop: 4, padding: '14px 44px', fontSize: 18 }}>
          ← Cancel &amp; Return to Cart
        </button>
      )}
    </div>
  )
}
