'use client'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useKioskStore } from '../../lib/store'

// Must match the empty-catalog retry cadence in page.tsx (emptyRetry interval)
// or the on-screen countdown drifts from the real retry loop.
const RETRY_SECONDS = 61

const SUPABASE_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname } catch { return 'supabase' }
})()

export default function OfflineScreen() {
  const { offline, browserOffline, config } = useKioskStore()

  // 1s tick so the countdown / elapsed labels stay live
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Tap the diagnostic strip 5× within 3s → read-only details overlay.
  // No PIN: nothing here is sensitive, and the whole point is letting whoever
  // is standing at the machine read the diagnosis to Jeff over the phone.
  const [taps, setTaps] = useState(0)
  const [showDetails, setShowDetails] = useState(false)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleStripTap = () => {
    setTaps((n) => {
      const next = n + 1
      if (tapTimer.current) clearTimeout(tapTimer.current)
      tapTimer.current = setTimeout(() => setTaps(0), 3000)
      if (next >= 5) { setTaps(0); setShowDetails(true) }
      return next
    })
  }

  if (!offline) return null

  const now = Date.now()
  const sinceStr = new Date(offline.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const elapsedMin = Math.max(0, Math.floor((now - offline.since) / 60000))
  const agoStr = elapsedMin >= 60 ? `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m ago` : `${elapsedMin}m ago`
  const nextIn = Math.max(0, RETRY_SECONDS - Math.floor((now - offline.lastAttemptAt) / 1000))
  const countdown = nextIn > 0 ? `next try in 0:${String(nextIn).padStart(2, '0')}` : 'retrying…'

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

      {/* Canyon logo — same asset + ambient treatment as the idle screen, smaller */}
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

      {/* Headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 12 }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#e8956b"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
        <div style={{ fontSize: 34, fontWeight: 400, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffffff' }}>
          Temporarily Offline
        </div>
      </div>

      {/* Friendly customer-facing copy */}
      <div style={{
        fontSize: 17, color: 'var(--text-muted)', maxWidth: 560, textAlign: 'center',
        lineHeight: 1.55, marginBottom: 22,
      }}>
        This market can&apos;t reach the network right now. Your snacks aren&apos;t going
        anywhere — check back in a few minutes.
      </div>

      {/* Auto-retry status pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        border: '1px solid rgba(239,159,39,0.45)', borderRadius: 60,
        padding: '11px 24px', marginBottom: 14,
      }}>
        <div className="offline-dot" />
        <span style={{ fontSize: 15, letterSpacing: '0.06em', color: '#EF9F27', fontWeight: 600 }}>
          {browserOffline
            ? 'Waiting for network — will reconnect automatically'
            : <>Reconnecting automatically&nbsp;&nbsp;·&nbsp;&nbsp;attempt {offline.attempts}&nbsp;&nbsp;·&nbsp;&nbsp;{countdown}</>}
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20 }}>
        Offline since {sinceStr} · {agoStr}
      </div>

      {/* Partner branding — same block as IdleScreen */}
      {hasPartner && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 12 }}>
            <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
            in partnership with
            <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
          </div>
          {isSteelFab && (
            <Image
              src="/Steelfab logo.png"
              alt="Steel Fab"
              width={300}
              height={76}
              style={{ objectFit: 'contain', width: 240, height: 'auto', opacity: 0.92 }}
            />
          )}
          {isMirabella && (
            <Image
              src="/Mirabella logo.png"
              alt="Mirabella at ASU"
              width={1850}
              height={306}
              style={{ objectFit: 'contain', width: 260, height: 'auto' }}
            />
          )}
        </div>
      )}

      {/* Diagnostic strip — dim enough for customers to ignore, complete enough
          to read over the phone. 5 taps opens the full details overlay. */}
      <div
        onClick={handleStripTap}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: '#141414', borderTop: '1px solid #2a2a2a',
          padding: '7px 16px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 16, cursor: 'default',
        }}
      >
        <span style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
          color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {config.machineId} · {config.locationName} · {SUPABASE_HOST} unreachable · {offline.lastError}
        </span>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          tap 5× for details
        </span>
      </div>

      {/* Details overlay */}
      {showDetails && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 850,
          background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', border: '2px solid var(--ember)', borderRadius: 20,
            padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 18, width: 620,
          }}>
            <div style={{ fontFamily: 'var(--font-brand)', fontSize: 24, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text)' }}>
              Connection Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 24px', fontSize: 15 }}>
              {([
                ['Machine',       `${config.machineId} — ${config.locationName}`],
                ['Server',        SUPABASE_HOST],
                ['Last error',    offline.lastError],
                ['Offline since', `${new Date(offline.since).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })} (${agoStr})`],
                ['Retries',       browserOffline ? `${offline.attempts} — device reports no network` : `attempt ${offline.attempts}, ${countdown}`],
              ] as const).map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{label}</span>
                  <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
              <button className="btn-primary" style={{ flex: 1, padding: '14px 0' }} onClick={() => window.location.reload()}>
                Retry Now
              </button>
              <button className="btn-outline" style={{ flex: 1, padding: '14px 0' }} onClick={() => setShowDetails(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
