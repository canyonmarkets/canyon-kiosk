'use client'
import { useState } from 'react'
import { useKioskStore } from '../lib/store'
import { supabase } from '../lib/supabase'
import { loadMarketProducts } from '../lib/loadMachineProducts'
import { X, RefreshCw } from 'lucide-react'

// ─── READ-ONLY PANEL (owner direction, 2026-07-04) ──────────────────────────
// The on-kiosk Admin Panel performs NO writes of any kind. All product
// assignment / config management happens in vending-dash (authenticated).
// app_config RLS is anon-read / authenticated-write, so kiosk-side writes
// would silently fail anyway — the mutating UI (add-product fix buttons,
// settings editor) was removed. What remains: today's sales, the assigned
// catalog, machine/config info, Restart App, and read-only sync diagnostics.

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const { config, products, setProducts, transactions } = useKioskStore()
  const [tab, setTab] = useState<'sales' | 'products' | 'settings'>('sales')

  // NOTE: there is intentionally NO "Sold Out" / hide control. Per Jeff
  // (2026-06-21) the kiosk always displays every assigned product — an item
  // that's physically out of stock simply can't be taken off the shelf and
  // scanned, so it never needs hiding. The only kiosk→dashboard flow is the
  // sale itself (a purchase decrements that machine's on-hand on the dashboard).

  // Diagnostics (read-only — refreshes the local catalog, never writes to the DB)
  const [diagRunning, setDiagRunning] = useState(false)
  const [diagResult, setDiagResult] = useState<string[] | null>(null)

  const runDiagnostics = async () => {
    setDiagRunning(true)
    setDiagResult(null)
    const lines: string[] = []
    try {
      const machineCode = config.machineId
      lines.push(`Machine code in config: "${machineCode}"`)

      // Step 1: look up machine DB id
      const { data: machineRow, error: machineErr } = await supabase
        .from('machines').select('id, code, name').eq('code', machineCode).single()
      if (machineErr || !machineRow) {
        lines.push(`⚠️ Machine lookup: NOT FOUND (${machineErr?.message ?? 'no row'})`)
      } else {
        lines.push(`✅ Machine found: id="${machineRow.id}" name="${machineRow.name}"`)
      }
      const dbId = machineRow?.id ?? machineCode

      // Step 2: load machineProductIds from app_config
      const { data: cfgRow, error: cfgErr } = await supabase
        .from('app_config').select('value').eq('key', 'machineProductIds').single()
      if (cfgErr || !cfgRow) {
        lines.push(`⚠️ app_config lookup: NOT FOUND`)
      } else {
        const all = cfgRow.value as Record<string, string[]>
        const byDbId = all[dbId]
        lines.push(`✅ machineProductIds: ${Object.keys(all).length} machines`)
        lines.push(byDbId ? `✅ Assignments for "${dbId}": ${byDbId.length} products` : `⚠️ No assignments for "${dbId}"`)
      }

      // Step 3: stale UUIDs + fixable products
      const assignedIds: string[] = (() => {
        if (!cfgRow?.value) return []
        const all = cfgRow.value as Record<string, string[]>
        return all[dbId] ?? all[machineCode] ?? []
      })()

      if (assignedIds.length > 0) {
        const { data: activeRows } = await supabase
          .from('products').select('id, name, upc').in('id', assignedIds).eq('status', 'Active')
        const activeIds = new Set((activeRows ?? []).map((r: any) => r.id))
        const staleCount = assignedIds.filter(id => !activeIds.has(id)).length
        if (staleCount > 0) lines.push(`⚠️ ${staleCount} stale UUIDs in list (clean up in vending-dash)`)
      }

      // Step 4: force-reload the local catalog (read-only against the DB)
      lines.push(`\nReloading products...`)
      const freshProducts = await loadMarketProducts(machineCode)
      lines.push(`✅ Loaded: ${freshProducts.length} products`)
      if (freshProducts.length > 0) {
        setProducts(freshProducts)
        lines.push(`✅ Kiosk product list updated`)
      }
    } catch (e: any) {
      lines.push(`❌ Error: ${e?.message ?? String(e)}`)
    }
    setDiagResult(lines)
    setDiagRunning(false)
  }

  // Today's sales
  const today = new Date().toDateString()
  const todayTx = transactions.filter((tx) => new Date(tx.completedAt).toDateString() === today)
  const todayRevenue = todayTx.reduce((s, tx) => s + tx.total, 0)
  const todayCount   = todayTx.length

  const reboot = () => {
    if (confirm('Restart the kiosk app?')) window.location.reload()
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 1000,
      background: '#111', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', background: '#1a1a1a',
        borderBottom: '2px solid var(--ember)', flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--font-brand)', fontSize: 22, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ember)' }}>
          Admin Panel — {config.machineId}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={22} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['sales', 'products', 'settings'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '14px 0', background: 'none',
            border: 'none', borderBottom: tab === t ? '2px solid var(--ember)' : '2px solid transparent',
            color: tab === t ? 'var(--ember)' : 'var(--text-muted)',
            fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="scrollable" style={{ flex: 1, padding: 24 }}>

        {/* ── Sales tab ── */}
        {tab === 'sales' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {[
                { label: "Today's Transactions", value: String(todayCount) },
                { label: "Today's Revenue", value: `$${todayRevenue.toFixed(2)}` },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: 'var(--surface)', borderRadius: 12, padding: '20px 24px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-brand)', fontSize: 36, color: 'var(--ember)' }}>{value}</div>
                </div>
              ))}
            </div>

            {todayTx.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 40, fontSize: 16 }}>No transactions today yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Time', 'Items', 'Total'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {todayTx.map((tx) => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                        {new Date(tx.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text)' }}>
                        {tx.items.map((i) => `${i.product.name} ×${i.qty}`).join(', ')}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--ember)', fontWeight: 700 }}>
                        ${tx.total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Products tab (read-only catalog reference) ── */}
        {tab === 'products' && (
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              Every product assigned to this machine is shown here and on the storefront —
              the kiosk always displays the full list. Products and prices are managed in the
              Canyon dashboard; this is a read-only reference.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Product', 'Category', 'Price'].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p.category}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        ${p.price.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Settings tab (read-only info — identity comes from the ?machine= start URL) ── */}
        {tab === 'settings' && (
          <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
              This panel is read-only. Machine identity is pinned by the kiosk&rsquo;s start URL
              (<span style={{ fontFamily: 'monospace' }}>?machine={config.machineId}</span>) and all
              configuration is managed in the Canyon dashboard.
            </p>
            {[
              { label: 'Machine ID',    value: config.machineId },
              { label: 'Location Name', value: config.locationName },
              { label: 'Partner Name',  value: config.partnerName ?? '—' },
              { label: 'Tax Rate',      value: `${(config.taxRate * 100).toFixed(1)}%` },
              { label: 'Products Loaded', value: String(products.length) },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ width: '100%', padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'white', fontSize: 15 }}>
                  {value}
                </div>
              </div>
            ))}

            <button onClick={reboot} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0', background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>
              <RefreshCw size={16} /> Restart App
            </button>

            {/* Diagnostics */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Inventory Diagnostics
              </div>
              <button
                onClick={runDiagnostics}
                disabled={diagRunning}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '12px 0',
                  background: diagRunning ? 'rgba(249,115,22,0.2)' : 'rgba(249,115,22,0.15)',
                  border: '1px solid var(--ember)', color: 'var(--ember)',
                  borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: diagRunning ? 'wait' : 'pointer',
                }}
              >
                <RefreshCw size={14} style={{ animation: diagRunning ? 'spin 1s linear infinite' : 'none' }} />
                {diagRunning ? 'Running…' : 'Run Sync Diagnostics'}
              </button>

              {diagResult && (
                <div style={{
                  marginTop: 12, background: '#0d1117', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '14px 16px',
                  fontFamily: 'monospace', fontSize: 12, color: '#c9d1d9', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto',
                }}>
                  {diagResult.join('\n')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
