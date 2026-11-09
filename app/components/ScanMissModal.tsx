'use client'
import { useEffect } from 'react'
import { useKioskStore } from '../lib/store'

// "Not scanning?" popup (Nov 9 2026). Replaces the small red "Not found" bar:
// a shopper whose item doesn't scan gets one big button to Browse and pick it.
// Styled like the Still Shopping popup. Closes itself after AUTO_CLOSE_SEC so
// a walk-away never leaves it covering the screen.
const AUTO_CLOSE_SEC = 20

export default function ScanMissModal({ onBrowse }: { onBrowse: () => void }) {
  const open = useKioskStore((s) => s.scanMissOpen)
  const at = useKioskStore((s) => s.scanMiss?.at)
  const close = useKioskStore((s) => s.closeScanMiss)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(close, AUTO_CLOSE_SEC * 1000)
    return () => clearTimeout(t)
  }, [open, at, close])

  if (!open) return null

  return (
    <div
      onClick={close}
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 490, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '2px solid var(--ember)',
          borderRadius: 20, padding: '44px 56px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
          maxWidth: 520, width: '90%', boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ fontSize: 56 }} aria-hidden>🔍</div>
        <div style={{ fontFamily: 'var(--font-brand)', fontSize: 34, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text)', textAlign: 'center' }}>
          Not Scanning?
        </div>
        <div style={{ fontSize: 21, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.45 }}>
          No problem. Browse items and<br />choose yours here.
        </div>
        <button
          onClick={onBrowse}
          style={{
            width: '100%', padding: '22px 18px', marginTop: 6,
            background: 'var(--ember)', border: 'none', color: 'white',
            fontFamily: 'var(--font-brand)', fontSize: 22, letterSpacing: '0.12em',
            textTransform: 'uppercase', borderRadius: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          }}
        >
          <span className="tap-finger" aria-hidden>👉</span> Browse Items
        </button>
        <button
          onClick={close}
          style={{
            width: '100%', padding: 16, background: 'transparent',
            border: '2px solid var(--border)', color: 'var(--text-muted)',
            fontSize: 16, fontWeight: 600, letterSpacing: '0.05em',
            textTransform: 'uppercase', borderRadius: 12, cursor: 'pointer',
          }}
        >
          Try Scanning Again
        </button>
      </div>
    </div>
  )
}
