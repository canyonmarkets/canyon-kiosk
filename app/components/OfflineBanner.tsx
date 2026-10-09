'use client'
import { useEffect, useState } from 'react'
import { useKioskStore } from '../lib/store'

export default function OfflineBanner() {
  const [browserDown, setBrowserDown] = useState(false)
  const screen = useKioskStore((s) => s.screen)
  // navigator.onLine alone missed the MB1 outage entirely (Android reports
  // onLine:true on a dead uplink), so the banner watches real server contact
  // too — otherwise someone browsing mid-outage gets no warning at all until
  // they reach the cart.
  const backendStale = useKioskStore((s) => s.backendStale)

  useEffect(() => {
    const onOnline  = () => setBrowserDown(false)
    const onOffline = () => setBrowserDown(true)
    setBrowserDown(!navigator.onLine)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  if (!browserDown && !backendStale) return null
  // On idle the full-screen OfflineScreen owns this state — the banner would
  // just stack on top of it. Mid-transaction screens still get the banner.
  if (screen === 'idle') return null

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 900,
      background: '#92400e', color: '#fef3c7',
      fontSize: 15, fontWeight: 600, letterSpacing: '0.05em',
      textAlign: 'center', padding: '10px 20px',
      borderBottom: '2px solid #d97706',
    }}>
      ⚠️ &nbsp; No internet connection — card payments temporarily unavailable. Please try again shortly.
    </div>
  )
}
