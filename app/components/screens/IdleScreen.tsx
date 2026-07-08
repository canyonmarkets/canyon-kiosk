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
  // MB      → Mirabella at ASU branding
  // CC1 / CC2 → plain Canyon Markets (no partner logo)
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
      paddingBottom: '20px',
      background: 'var(--bg)',
      gap: 0,
    }}>

      {/* Canyon logo — hero-sized, breathing ember glow, gentle float */}
      <div className="idle-logo-wrap" style={{ marginBottom: 6 }}>
        <div className="idle-glow" />
        <Image
          src="/Canyon_Logo-removebg-preview.png"
          alt="Canyon Markets"
          width={420}
          height={420}
          style={{
            objectFit: 'contain',
            width: 'min(50vh, 38vw, 560px)',
            height: 'auto',
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.7))',
          }}
          priority
        />
      </div>

      {/* Brand name — metallic shimmer sweep */}
      <div className="brand-shimmer" style={{
        fontFamily: 'var(--font-brand)', fontSize: 40, letterSpacing: '0.14em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>
        Canyon Markets
      </div>

      {/* Scan to begin — the primary action, animated barcode + breathing text */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 14, marginBottom: 12 }}>
        <div className="barcode-glyph" aria-hidden>
          {[3, 6, 3, 9, 4, 3, 7, 3, 5, 8, 3, 5].map((w, i) => (
            <div key={i} className="bar" style={{ width: w }} />
          ))}
          <div className="beam" />
        </div>
        <div className="scan-cta" style={{ fontSize: 38, fontWeight: 400, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ffffff' }}>
          Scan Item to Begin
        </div>
      </div>

      {/* Scanner status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div className="scanner-dot" style={{ background: (productsLoading || catalogEmpty) ? 'var(--ember)' : undefined }} />
        <span style={{ color: (productsLoading || catalogEmpty) ? 'var(--ember)' : 'var(--green)', fontSize: 14, fontWeight: 600, letterSpacing: '0.08em' }}>
          {productsLoading ? 'Loading Inventory…' : catalogEmpty ? 'Inventory Syncing — One Moment…' : 'Scanner Ready'}
        </span>
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 14 }}>
        <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
        or
        <div style={{ width: 70, height: 1, background: 'var(--border)' }} />
      </div>

      {/* Button + partner branding — same-width column so logo matches button */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 340 }}>

        {/* Quiet outline style — scanning is the primary action, this is the fallback */}
        <button
          className="btn-primary"
          onClick={() => setScreen('browse')}
          style={{
            width: 240,
            fontSize: 15, letterSpacing: '0.16em',
            padding: '13px 0', borderRadius: 60,
            background: 'transparent',
            border: '2px solid rgba(201,75,12,0.75)',
            color: '#e8956b',
            marginBottom: hasPartner ? 20 : 0,
          }}
        >
          Browse Items
        </button>

        {/* Partner branding — SF1 / SF2 (Steel Fab) or MB (Mirabella at ASU) */}
        {hasPartner && (
          <>
            {/* "IN PARTNERSHIP WITH" — same font/weight as Scan Item to Begin */}
            <div style={{
              fontSize: 15, fontWeight: 300, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: '#9ca3af',
              marginBottom: 10,
            }}>
              In Partnership With
            </div>

            {isSteelFab && (
              /* Steel Fab logo — light silver artwork sits directly on the dark splash */
              <Image
                src="/Steelfab logo.png"
                alt="Steel Fab"
                width={300}
                height={76}
                style={{ objectFit: 'contain', width: 300, height: 'auto', opacity: 0.92 }}
              />
            )}

            {isMirabella && (
              /* Mirabella logo — dark/colored brand artwork, so it rides a clean white
                 plaque to stay legible and brand-accurate against the dark background */
              <div style={{
                background: '#ffffff',
                borderRadius: 16,
                padding: '16px 22px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Image
                  src="/Mirabella logo.png"
                  alt="Mirabella at ASU"
                  width={1870}
                  height={660}
                  style={{ objectFit: 'contain', width: 268, height: 'auto', display: 'block' }}
                />
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}
