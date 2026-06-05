'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useKioskStore } from '../../lib/store'

const RETURN_SECONDS = 8

export default function ThankYouScreen({ lastTotal, isActive }: { lastTotal: number; isActive: boolean }) {
  const { setScreen } = useKioskStore()
  const [secs, setSecs] = useState(RETURN_SECONDS)

  useEffect(() => {
    if (!isActive) { setSecs(RETURN_SECONDS); return }
    setSecs(RETURN_SECONDS)
    const interval = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) { clearInterval(interval); setScreen('idle'); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isActive, setScreen])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: 'var(--bg)' }}>
      <Image
        src="/Canyon_Logo-removebg-preview.png"
        alt="Canyon Markets"
        width={100}
        height={100}
        style={{ objectFit: 'contain', animation: 'check-pop 0.4s cubic-bezier(0.175,0.885,0.32,1.275)', filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.6))' }}
      />

      <div style={{ fontFamily: 'var(--font-brand)', fontSize: 52, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--green)' }}>
        Payment Approved
      </div>

      <div style={{ fontSize: 26, color: 'var(--text-muted)' }}>
        ${lastTotal.toFixed(2)} charged
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ fontSize: 24, color: 'var(--text)' }}>Thank You for Shopping</div>
        <div style={{
          fontFamily: 'var(--font-brand)', fontSize: 40, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--text)',
          textShadow: '-1px -1px 0 rgba(255,255,255,0.12), 1px 1px 0 rgba(0,0,0,0.7)',
        }}>
          Canyon Markets
        </div>
      </div>

      <div style={{ fontSize: 15, color: 'var(--text-dim)', marginTop: 10 }}>
        Returning to start in {secs} second{secs !== 1 ? 's' : ''}…
      </div>
    </div>
  )
}
