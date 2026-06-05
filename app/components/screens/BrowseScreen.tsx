'use client'
import Image from 'next/image'
import { useKioskStore } from '../../lib/store'
import { CATEGORIES, ACTIVE_CATEGORIES } from '../../lib/products'

export default function BrowseScreen() {
  const { setScreen, setActiveCategory, cart, cartCount } = useKioskStore()
  const itemCount = cartCount()

  const goBack = () => {
    if (cart.length > 0) setScreen('cart')
    else setScreen('idle')
  }

  const openCategory = (cat: string) => {
    setActiveCategory(cat)
    setScreen('products')
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div className="kiosk-header">
        <button className="btn-back" onClick={goBack}>← Back</button>
        <div className="header-title" style={{ fontFamily: 'var(--font-brand)', fontSize: 26, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Choose a Category
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

      {/* Category grid */}
      <div style={{
        flex: 1, padding: '20px 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: `repeat(${Math.ceil(ACTIVE_CATEGORIES.length / 3)}, 1fr)`,
        gap: 16, overflow: 'hidden',
      }}>
        {ACTIVE_CATEGORIES.map((cat) => {
          const meta = CATEGORIES[cat]
          if (!meta) return null
          return (
            <button
              key={cat}
              onClick={() => openCategory(cat)}
              style={{
                background: 'var(--surface)', border: '2px solid var(--border)',
                borderRadius: 18, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 14,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onPointerDown={(e) => {
                const el = e.currentTarget
                el.style.borderColor = 'var(--ember)'
                el.style.background  = 'var(--surface-2)'
                el.style.transform   = 'scale(0.97)'
              }}
              onPointerUp={(e) => {
                const el = e.currentTarget
                el.style.borderColor = 'var(--border)'
                el.style.background  = 'var(--surface)'
                el.style.transform   = 'scale(1)'
              }}
            >
              <Image
                src={meta.icon}
                alt={meta.label}
                width={160}
                height={160}
                style={{ objectFit: 'contain', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}
              />
              <span style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text)' }}>
                {meta.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
