'use client'
import { useKioskStore } from '../../lib/store'
import Image from 'next/image'

export default function CartScreen() {
  const { setScreen, cart, clearCart, changeQty, cartSubtotal, cartTax, cartTotal, cartCount, config } = useKioskStore()

  const count    = cartCount()
  const subtotal = cartSubtotal()
  const tax      = cartTax()
  const total    = cartTotal()

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <div className="kiosk-header">
        <div className="header-logo">
          <Image src="/Canyon_Logo-removebg-preview.png" alt="" width={52} height={52} style={{ objectFit: 'contain' }} />
          <span className="header-logo-name">Canyon Markets</span>
        </div>
        <div className="header-title">
          Your Cart &nbsp;
          <span style={{ background: 'var(--ember)', color: 'white', fontSize: 14, padding: '3px 12px', borderRadius: 20, fontWeight: 700 }}>
            {count} {count === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="scanner-status">
          <div className="scanner-dot" />
          <span>Keep Scanning</span>
        </div>
      </div>

      {/* Items */}
      <div className="scrollable" style={{ flex: 1, padding: '16px 24px' }}>
        {cart.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, color: 'var(--text-dim)' }}>
            <div style={{ fontSize: 60 }}>🛒</div>
            <div style={{ fontSize: 20, textAlign: 'center', lineHeight: 1.4 }}>
              Scan an item or tap Browse<br />to add products to your cart
            </div>
          </div>
        ) : (
          cart.map(({ product, qty }) => (
            <div
              key={product.id}
              style={{
                display: 'flex', alignItems: 'center',
                background: 'var(--surface)', borderRadius: 14,
                padding: '18px 22px', marginBottom: 10,
                border: '1px solid var(--border)', gap: 18,
              }}
            >
              <span style={{ flex: 1, fontSize: 20, fontWeight: 500, lineHeight: 1.3, color: 'var(--text)' }}>
                {product.name}
              </span>

              {/* Qty controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                <button
                  onClick={() => changeQty(product.id, -1)}
                  style={{
                    width: 50, height: 50, borderRadius: '50%',
                    border: `2px solid ${qty === 1 ? 'var(--red)' : 'var(--ember)'}`,
                    background: 'transparent',
                    color: qty === 1 ? 'var(--red)' : 'var(--ember)',
                    fontSize: 26, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}
                >
                  {qty === 1 ? '✕' : '−'}
                </button>
                <span style={{ fontSize: 28, fontWeight: 700, minWidth: 32, textAlign: 'center' }}>{qty}</span>
                <button
                  onClick={() => changeQty(product.id, 1)}
                  style={{
                    width: 50, height: 50, borderRadius: '50%',
                    border: '2px solid var(--ember)', background: 'transparent',
                    color: 'var(--ember)', fontSize: 26, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}
                >
                  +
                </button>
              </div>

              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--ember)', minWidth: 72, textAlign: 'right', flexShrink: 0 }}>
                ${(product.price * qty).toFixed(2)}
              </span>
            </div>
          ))
        )}
        <div style={{ height: 12 }} />
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '18px 28px 22px', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
          {[
            { label: 'Subtotal', val: `$${subtotal.toFixed(2)}` },
            { label: `Tax (${(config.taxRate * 100).toFixed(1)}%)`, val: `$${tax.toFixed(2)}` },
          ].map(({ label, val }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 19, fontWeight: 500, color: 'var(--text-muted)' }}>
              <span>{label}</span><span>{val}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, fontWeight: 500, color: 'var(--text)', paddingTop: 10, borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          <button className="btn-outline" onClick={() => setScreen('browse')} style={{ flex: 1, padding: 18 }}>
            + Browse
          </button>
          <button
            onClick={() => { clearCart(); setScreen('idle') }}
            title="Cancel & return home"
            style={{
              flex: 1, borderRadius: 12, border: '2px solid var(--ember)',
              background: 'transparent', color: 'var(--ember)', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 5, padding: '14px 10px',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Home</span>
          </button>
          <button
            className="btn-primary"
            onClick={() => setScreen('payment')}
            disabled={cart.length === 0}
            style={{ flex: 1, padding: 18, fontSize: 21 }}
          >
            Pay Now →
          </button>
        </div>
      </div>
    </div>
  )
}
