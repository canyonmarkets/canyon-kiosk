'use client'
import Image from 'next/image'
import { useKioskStore } from '../../lib/store'

export default function IdleScreen() {
  const { setScreen, config, productsLoading, products } = useKioskStore()

  // Catalog failed to load (or machine has no assignments) — the storefront is
  // intentionally empty and the app retries every minute. Tell staff on-site
  // rather than claiming "Scanner Ready" when no scan could possibly match.
  const catalogEmpty = !productsLoading && products.length === 0

  // Derive partner from machine code — no manual config needed
  // SF1 / SF2 → Steel Fab branding
  // CC1 / CC2 → plain Canyon Markets (no partner logo)
  const isSteelFab = config.machineId.toUpperCase().startsWith('SF')

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      // SF layout: flex-start so the SF logo fills the bottom naturally
      // Canyon layout: centered as before
      justifyContent: isSteelFab ? 'flex-start' : 'center',
      paddingTop:    isSteelFab ? '5vh' : '24px',
      paddingBottom: '20px',
      background: 'var(--bg)',
      gap: 0,
    }}>

      {/* Canyon logo */}
      <Image
        src="/Canyon_Logo-removebg-preview.png"
        alt="Canyon Markets"
        width={220}
        height={220}
        style={{ objectFit: 'contain', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.7))', marginBottom: 10 }}
        priority
      />

      {/* Brand name */}
      <div style={{
        fontFamily: 'var(--font-brand)', fontSize: 44, letterSpacing: '0.14em',
        color: '#fff', textTransform: 'uppercase', marginBottom: 8,
        textShadow: '-1px -1px 0 rgba(255,255,255,0.15), 1px 1px 0 rgba(0,0,0,0.85), 3px 3px 10px rgba(0,0,0,0.4)',
      }}>
        Canyon Markets
      </div>

      {/* Location */}
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        {config.locationName}
      </div>

      {/* Scan to begin */}
      <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#d1d5db', marginBottom: 10 }}>
        Scan Item to Begin
      </div>

      {/* Scanner status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
        <div className="scanner-dot" style={{ background: (productsLoading || catalogEmpty) ? 'var(--ember)' : undefined }} />
        <span style={{ color: (productsLoading || catalogEmpty) ? 'var(--ember)' : 'var(--green)', fontSize: 14, fontWeight: 600, letterSpacing: '0.08em' }}>
          {productsLoading ? 'Loading Inventory…' : catalogEmpty ? 'Inventory Syncing — One Moment…' : 'Scanner Ready'}
        </span>
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 22 }}>
        <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
        or
        <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
      </div>

      {/* Button + partner branding — same-width column so logo matches button */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 340 }}>

        <button
          className="btn-primary"
          onClick={() => setScreen('browse')}
          style={{
            width: '100%',
            fontSize: 19, letterSpacing: '0.16em',
            padding: '20px 0', borderRadius: 60,
            marginBottom: isSteelFab ? 20 : 0,
          }}
        >
          Browse Items
        </button>

        {/* Steel Fab partner branding — SF1 / SF2 only */}
        {isSteelFab && (
          <>
            {/* "IN PARTNERSHIP WITH" — same font/weight as Scan Item to Begin */}
            <div style={{
              fontSize: 18, fontWeight: 300, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: '#9ca3af',
              marginBottom: 14,
            }}>
              In Partnership With
            </div>

            {/* Steel Fab logo — same width as Browse button */}
            <Image
              src="/Steelfab logo.png"
              alt="Steel Fab"
              width={340}
              height={86}
              style={{ objectFit: 'contain', width: '100%', height: 'auto', opacity: 0.92 }}
            />
          </>
        )}
      </div>

    </div>
  )
}
