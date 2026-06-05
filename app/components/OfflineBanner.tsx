'use client'
import { useEffect, useState } from 'react'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const onOnline  = () => setOffline(false)
    const onOffline = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  if (!offline) return null

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
