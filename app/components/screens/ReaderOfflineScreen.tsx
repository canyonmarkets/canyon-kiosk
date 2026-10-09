'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useKioskStore } from '../../lib/store'

// Same public Google Voice line as OfflineScreen (never a personal cell).
const SUPPORT_TEXT_NUMBER = '(602) 935-6830'

// Shown in place of the attract screen when the tablet is fine but its card
// reader is off the network (MB1, 2026-10-09). There's no "tap to start": a
// shopper should know before picking anything up that this kiosk can't take a
// card right now. Clears on its own once the reader is back.
export default function ReaderOfflineScreen() {
  const { readerOfflineSince, config } = useKioskStore()

  // 30s tick keeps the "since" line honest without a busy render loop
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30 * 1000)
    return () => clearInterval(t)
  }, [])

  const since = readerOfflineSince ?? Date.now()
  const sinceStr = new Date(since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const elapsedMin = Math.max(0, Math.floor((Date.now() - since) / 60000))
  const agoStr = elapsedMin >= 60 ? `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m ago` : `${elapsedMin}m ago`

  // Same partner derivation as IdleScreen
  const machineUpper = config.machineId.toUpperCase()
  const isSteelFab  = machineUpper.startsWith('SF')
  const isMirabella = machineUpper.startsWith('MB')
  const hasPartner  = isSteelFab || isMirabella

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center',
      paddingTop: '16px',
      paddingBottom: '44px',
      background: 'var(--bg)',
      gap: 0,
    }}>

      <div className="idle-logo-wrap" style={{ marginBottom: 4 }}>
        <div className="idle-glow" />
        <Image
          src="/Canyon_Logo-removebg-preview.png"
          alt="Canyon Markets"
          width={300}
          height={300}
          style={{
            objectFit: 'contain',
            width: 'min(30vh, 22vw, 320px)',
            height: 'auto',
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.7))',
          }}
          priority
        />
      </div>

      <div className="brand-shimmer" style={{
        fontFamily: 'var(--font-brand)', fontSize: 30, letterSpacing: '0.14em',
        textTransform: 'uppercase', marginBottom: 22,
      }}>
        Canyon Markets
      </div>

      {/* Headline: card with a slash through it */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 14 }}>
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#e8956b"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <div style={{ fontSize: 46, fontWeight: 400, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffffff' }}>
          Card Reader Offline
        </div>
      </div>

      <div style={{
        fontSize: 22, color: 'var(--text-muted)', maxWidth: 720, textAlign: 'center',
        lineHeight: 1.55, marginBottom: 24,
      }}>
        We can&apos;t take payments at this market right now, so please don&apos;t take
        anything off the shelves. Check back soon.
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        border: '1px solid rgba(239,159,39,0.45)', borderRadius: 60,
        padding: '14px 30px', marginBottom: 16,
      }}>
        <div className="offline-dot" />
        <span style={{ fontSize: 19, letterSpacing: '0.06em', color: '#EF9F27', fontWeight: 600 }}>
          This screen clears on its own when the reader reconnects
        </span>
      </div>

      <div style={{ fontSize: 16, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Offline since {sinceStr} · {agoStr}
      </div>

      {/* True: stripe-reader-alert emails within ~5 min of the reader dropping */}
      <div style={{ fontSize: 18, color: 'var(--text-muted)', marginBottom: SUPPORT_TEXT_NUMBER ? 8 : 22 }}>
        Our team has been notified automatically.
      </div>
      {SUPPORT_TEXT_NUMBER && (
        <div style={{ fontSize: 18, color: 'var(--text-muted)', marginBottom: 22 }}>
          Questions? Text us: <span style={{ color: '#e8956b', fontWeight: 600, fontSize: 19 }}>{SUPPORT_TEXT_NUMBER}</span>
        </div>
      )}

      {hasPartner && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 12 }}>
            <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
            in partnership with
            <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
          </div>
          {isSteelFab && (
            <Image src="/Steelfab logo.png" alt="Steel Fab" width={300} height={76}
              style={{ objectFit: 'contain', width: 240, height: 'auto', opacity: 0.92 }} />
          )}
          {isMirabella && (
            <Image src="/Mirabella logo.png" alt="Mirabella at ASU" width={1850} height={306}
              style={{ objectFit: 'contain', width: 260, height: 'auto' }} />
          )}
        </div>
      )}

      {/* Diagnostic strip: dim for shoppers, readable over the phone */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: '#141414', borderTop: '1px solid #2a2a2a',
        padding: '7px 16px',
      }}>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: 'var(--text-dim)' }}>
          {config.machineId} · {config.locationName} · Stripe reader offline · tablet online
        </span>
      </div>
    </div>
  )
}
