'use client'
import { useEffect, useState } from 'react'
import { useKioskStore } from '../lib/store'

const COUNTDOWN_SEC = 60

interface Props {
  visible: boolean
  onKeep: () => void
  onCancel: () => void
}

export default function TimeoutModal({ visible, onKeep, onCancel }: Props) {
  const [secs, setSecs] = useState(COUNTDOWN_SEC)

  useEffect(() => {
    if (!visible) { setSecs(COUNTDOWN_SEC); return }
    setSecs(COUNTDOWN_SEC)
    const interval = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) { clearInterval(interval); onCancel(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [visible, onCancel])

  if (!visible) return null

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.75)',
      zIndex: 500, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--surface)', border: '2px solid var(--ember)',
        borderRadius: 20, padding: '48px 56px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        maxWidth: 480, width: '90%',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
      }}>
        <div style={{ fontSize: 52 }}>👋</div>
        <div style={{ fontFamily: 'var(--font-brand)', fontSize: 32, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text)', textAlign: 'center' }}>
          Still Shopping?
        </div>
        <div style={{ fontSize: 18, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
          Your cart will be cleared in
        </div>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          border: '4px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--ember)' }}>{secs}</span>
        </div>
        <div style={{ fontSize: 18, color: 'var(--text-muted)', textAlign: 'center' }}>
          seconds unless you continue.
        </div>
        <div style={{ display: 'flex', gap: 14, width: '100%' }}>
          <button
            onClick={onKeep}
            style={{
              flex: 2, padding: 18, background: 'var(--ember)', border: 'none', color: 'white',
              fontFamily: 'var(--font-brand)', fontSize: 17, letterSpacing: '0.12em',
              textTransform: 'uppercase', borderRadius: 12, cursor: 'pointer',
            }}
          >
            Yes, Keep Shopping
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: 18, background: 'transparent',
              border: '2px solid var(--border)', color: 'var(--text-muted)',
              fontSize: 15, fontWeight: 600, letterSpacing: '0.05em',
              textTransform: 'uppercase', borderRadius: 12, cursor: 'pointer',
            }}
          >
            Cancel Order
          </button>
        </div>
      </div>
    </div>
  )
}
