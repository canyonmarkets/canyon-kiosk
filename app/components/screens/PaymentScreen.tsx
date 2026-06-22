'use client'
import { useEffect, useRef, useState } from 'react'
import { useKioskStore } from '../../lib/store'

const PAYMENT_TIMEOUT_SEC = 90
const POLL_INTERVAL_MS = 2500
const SUPABASE_URL = 'https://zgmxmficzvlpzkosdcnx.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_MUAaPltQkyDFsR0NvLTikQ_gY_pfJFy'

type PayStatus = 'idle' | 'sending' | 'waiting' | 'approved' | 'declined' | 'timeout' | 'error'

export default function PaymentScreen({ onApproved, isActive }: { onApproved: (total: number) => void; isActive: boolean }) {
  const { setScreen, cartTotal, cartSubtotal, cartTax, cart, config, addTransaction, clearCart } = useKioskStore()
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const refIdRef   = useRef<string | null>(null)
  const [payStatus, setPayStatus] = useState<PayStatus>('idle')
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null)
  const total = cartTotal()

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const handleApproved = () => {
    stopPolling()
    // Capture totals BEFORE clearing the cart — both the saved transaction and
    // the thank-you screen need them, and clearCart() would zero them out.
    // (Use the store's own subtotal/tax rather than reverse-deriving from the
    // total, so the numbers are exact for the receipt / future kiosk_sales.)
    const finalSubtotal = cartSubtotal()
    const finalTax      = cartTax()
    const finalTotal    = cartTotal()
    const tx = {
      id: refIdRef.current ?? `tx_${Date.now()}`,
      items: [...cart],
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
    const amountCents = Math.round(total * 100)
    const referenceId = `${config.machineId}-${Date.now()}`
    refIdRef.current = referenceId
    setPayStatus('sending')
    setErrorMsg(null)
    // Send the cart so the `charge` fn can persist a kiosk_sales row at charge time
    // (the bridge into vending-dash). subtotal is PRE-TAX — the revenue figure.
    const items = cart.map((i) => ({
      productId: i.product.id, name: i.product.name, qty: i.qty, unitPrice: i.product.price,
    }))
    const subtotal = cartSubtotal()
    const tax = cartTax()
    console.log('[payment] startPayment called', { amountCents, referenceId, SUPABASE_URL, total })

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/charge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ amountCents, referenceId, machineId: config.machineId, items, subtotal, tax }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error ?? 'Charge request failed')
      }

      setPayStatus('waiting')

      // Timeout — if terminal never responds
      timerRef.current = setTimeout(() => {
        stopPolling()
        setPayStatus('timeout')
        setTimeout(() => setScreen('cart'), 4000)
      }, PAYMENT_TIMEOUT_SEC * 1000)

      // Poll for terminal result
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(
            `${SUPABASE_URL}/functions/v1/charge-status?ref=${referenceId}`,
            { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
          )
          const { status } = await statusRes.json()
          if (status === 'PROCESSED') {
            setPayStatus('approved')
            setTimeout(handleApproved, 800)
          } else if (status === 'CANCELED') {
            // Return to the cart on a decline/cancel instead of silently re-sending
            // a brand-new charge in a loop (which risked double charges and a
            // terminal left armed). The shopper re-initiates payment deliberately.
            stopPolling()
            setPayStatus('declined')
            setTimeout(() => setScreen('cart'), 3500)
          }
        } catch {
          // network blip — keep polling
        }
      }, POLL_INTERVAL_MS)

    } catch (err) {
      // Log the real error for diagnostics, but never show raw technical text
      // to a customer at the terminal.
      console.error('[payment] charge failed:', err)
      setPayStatus('error')
      setErrorMsg('We couldn’t start the payment. Please try again, or ask a team member for help.')
    }
  }

  useEffect(() => {
    console.log('[payment] isActive changed:', isActive)
    if (!isActive) {
      stopPolling()
      setPayStatus('idle')
      setErrorMsg(null)
      refIdRef.current = null
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

      <button className="btn-outline" onClick={async () => {
        stopPolling()
        if (refIdRef.current) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/charge-cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
              body: JSON.stringify({ referenceId: refIdRef.current, machineId: config.machineId }),
            })
          } catch { /* non-fatal — reader will time out on its own */ }
        }
        setScreen('cart')
      }} style={{ marginTop: 4, padding: '14px 44px', fontSize: 18 }}>
        ← Cancel &amp; Return to Cart
      </button>
    </div>
  )
}
