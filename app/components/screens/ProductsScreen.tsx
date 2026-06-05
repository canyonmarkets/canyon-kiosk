'use client'
import { useState } from 'react'
import { useKioskStore } from '../../lib/store'
import { CATEGORIES } from '../../lib/products'

export default function ProductsScreen() {
  const { setScreen, activeCategory, products, addToCart, cartCount } = useKioskStore()
  const itemCount = cartCount()
  const [justAdded, setJustAdded] = useState<Record<string, boolean>>({})

  const catMeta  = activeCategory ? CATEGORIES[activeCategory] : null
  const filtered = products.filter((p) => p.category === activeCategory && p.available)

  const handleAdd = (id: string) => {
    const product = products.find((p) => p.id === id)
    if (!product) return
    addToCart(product)
    setJustAdded((prev) => ({ ...prev, [id]: true }))
    setTimeout(() => setJustAdded((prev) => ({ ...prev, [id]: false })), 1200)
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div className="kiosk-header">
        <button className="btn-back" onClick={() => setScreen('browse')}>← Categories</button>
        <div className="header-title" style={{ fontFamily: 'var(--font-brand)', fontSize: 26, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {catMeta?.label ?? 'Products'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="scanner-status">
            <div className="scanner-dot" />
            <span>Scanner Active</span>
          </div>
          <button
            onClick={() => setScreen('cart')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: itemCount > 0 ? 'var(--ember)' : 'var(--surface-2)',
              border: `2px solid ${itemCount > 0 ? 'var(--ember)' : 'var(--border)'}`,
              borderRadius: 10, padding: '8px 16px', cursor: 'pointer',
              color: itemCount > 0 ? 'white' : 'var(--text-muted)',
              fontSize: 15, fontWeight: 700, transition: 'all 0.15s',
            }}
          >
            🛒
            {itemCount > 0 && (
              <span style={{
                background: 'white', color: 'var(--ember)',
                borderRadius: '50%', width: 22, height: 22,
                fontSize: 12, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {itemCount}
              </span>
            )}
            <span>{itemCount > 0 ? 'View Cart' : 'Cart'}</span>
          </button>
        </div>
      </div>

      <div className="scrollable" style={{ flex: 1, padding: '16px 24px' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 18 }}>
            No items available in this category right now.
          </div>
        )}
        {filtered.map((product) => {
          const added = justAdded[product.id]
          return (
            <div
              key={product.id}
              style={{
                display: 'flex', alignItems: 'center',
                background: added ? '#052e16' : 'var(--surface)',
                borderRadius: 14, padding: '20px 24px', marginBottom: 10,
                border: `1px solid ${added ? 'var(--green)' : 'var(--border)'}`,
                transition: 'all 0.2s', gap: 16,
              }}
            >
              <span style={{ flex: 1, fontSize: 21, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
                {product.name}
              </span>
              <span style={{ fontSize: 21, fontWeight: 700, color: 'var(--ember)', flexShrink: 0 }}>
                ${product.price.toFixed(2)}
              </span>
              <button
                onClick={() => handleAdd(product.id)}
                style={{
                  background: added ? 'var(--green)' : 'var(--ember)',
                  color: 'white', border: 'none',
                  padding: '13px 26px', borderRadius: 10,
                  fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  minWidth: 110, textAlign: 'center', flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              >
                {added ? '✓ Added!' : '+ Add'}
              </button>
            </div>
          )
        })}
        {/* Bottom padding so last item isn't flush */}
        <div style={{ height: 16 }} />
      </div>
    </div>
  )
}
