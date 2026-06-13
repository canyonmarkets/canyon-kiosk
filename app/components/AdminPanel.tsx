'use client'
import { useState, useEffect } from 'react'
import { useKioskStore } from '../lib/store'
import { supabase } from '../lib/supabase'
import { loadMarketProducts } from '../lib/loadMachineProducts'
import { X, Save, RefreshCw, Settings } from 'lucide-react'
import type { MachineConfig } from '../types'

const MACHINE_IDS = ['SF1', 'SF2', 'CC1', 'CC2', 'MB', 'EARN', 'COMBS', 'ND', 'CAP']

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const { config, updateConfig, products, setProducts, toggleProductAvailable, transactions } = useKioskStore()
  const [tab, setTab] = useState<'sales' | 'products' | 'settings'>('sales')
  const [draft, setDraft] = useState<MachineConfig>({ ...config })

  // Resolve this kiosk's machine DB id once, so sold-out writes target the
  // same per-machine key (machineHidden[dbId]) the loader reads.
  const [machineDbId, setMachineDbId] = useState<string>(config.machineId)
  const [savingSoldOut, setSavingSoldOut] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    supabase.from('machines').select('id').eq('code', config.machineId).single()
      .then(({ data }) => { if (active) setMachineDbId(data?.id ?? config.machineId) })
    return () => { active = false }
  }, [config.machineId])

  // Toggle a product Sold Out for THIS machine and persist it to Supabase so it
  // survives the 5-minute product refresh (the old local-only toggle reverted).
  const toggleSoldOut = async (productId: string, currentlyAvailable: boolean) => {
    setSavingSoldOut(productId)
    toggleProductAvailable(productId)  // optimistic local update
    try {
      const { data: row } = await supabase
        .from('app_config').select('value').eq('key', 'machineHidden').maybeSingle()
      const all = (row?.value ?? {}) as Record<string, string[]>
      const current = all[machineDbId] ?? []
      const next = currentlyAvailable
        ? [...new Set([...current, productId])]        // now hidden / sold out
        : current.filter((id) => id !== productId)     // back in stock
      await supabase.from('app_config').upsert({ key: 'machineHidden', value: { ...all, [machineDbId]: next } })
    } catch (e) {
      console.warn('[admin] sold-out save failed', e)
      toggleProductAvailable(productId)  // roll back the optimistic flip
    } finally {
      setSavingSoldOut(null)
    }
  }

  // Diagnostics
  const [diagRunning, setDiagRunning] = useState(false)
  const [diagResult, setDiagResult] = useState<string[] | null>(null)
  const [fixableProducts, setFixableProducts] = useState<Array<{id: string; name: string; upc: string}>>([])
  const [fixing, setFixing] = useState<string | null>(null)

  const runDiagnostics = async () => {
    setDiagRunning(true)
    setDiagResult(null)
    setFixableProducts([])
    const lines: string[] = []
    const newFixable: Array<{id: string; name: string; upc: string}> = []
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
        if (staleCount > 0) lines.push(`⚠️ ${staleCount} stale UUIDs in list (can be cleaned up)`)
      }

      // Step 4: search all Skittles globally
      lines.push(`\n--- Skittles Check ---`)
      const { data: globalSkittles } = await supabase
        .from('products').select('id, name, upc, status')
        .ilike('name', '%skittles%')
      if (!globalSkittles || globalSkittles.length === 0) {
        lines.push(`❌ No Skittles in global inventory`)
      } else {
        globalSkittles.forEach((s: any) => {
          const inList = assignedIds.includes(s.id)
          lines.push(`"${s.name}" | UPC: ${s.upc || '(empty)'} | Status: ${s.status} | ${inList ? 'Assigned ✅' : 'NOT assigned ❌'}`)
          if (!inList && s.status === 'Active') {
            newFixable.push({ id: s.id, name: s.name, upc: s.upc ?? '' })
          }
        })
      }

      // Step 5: force-reload
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
    setFixableProducts(newFixable)
    setDiagRunning(false)
  }

  const fixAssignment = async (productId: string, productName: string) => {
    setFixing(productId)
    try {
      const machineCode = config.machineId
      const { data: machineRow } = await supabase
        .from('machines').select('id').eq('code', machineCode).single()
      const dbId = machineRow?.id ?? machineCode

      // Always read fresh from Supabase before writing
      const { data: cfgRow } = await supabase
        .from('app_config').select('value').eq('key', 'machineProductIds').single()
      const all = (cfgRow?.value ?? {}) as Record<string, string[]>
      const current = all[dbId] ?? []

      if (current.includes(productId)) {
        setDiagResult(prev => [...(prev ?? []), `ℹ️ Already assigned`])
        return
      }

      const updated = { ...all, [dbId]: [...current, productId] }
      const { error } = await supabase
        .from('app_config').upsert({ key: 'machineProductIds', value: updated })

      if (error) {
        setDiagResult(prev => [...(prev ?? []), `❌ Save failed: ${error.message}`])
      } else {
        setFixableProducts(prev => prev.filter(p => p.id !== productId))
        const freshProducts = await loadMarketProducts(machineCode)
        if (freshProducts.length > 0) setProducts(freshProducts)
        setDiagResult(prev => [...(prev ?? []), `✅ "${productName}" added to ${machineCode}! Kiosk updated.`])
      }
    } catch (e: any) {
      setDiagResult(prev => [...(prev ?? []), `❌ Error: ${e?.message ?? String(e)}`])
    } finally {
      setFixing(null)
    }
  }

  // Today's sales
  const today = new Date().toDateString()
  const todayTx = transactions.filter((tx) => new Date(tx.completedAt).toDateString() === today)
  const todayRevenue = todayTx.reduce((s, tx) => s + tx.total, 0)
  const todayCount   = todayTx.length

  const saveSettings = () => {
    updateConfig(draft)
    alert('Settings saved!')
  }

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

        {/* ── Products tab ── */}
        {tab === 'products' && (
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              Mark items <strong>Sold Out</strong> to hide them on this machine — it saves to the
              cloud and sticks across refreshes. Prices are set in the Canyon dashboard and shown
              here for reference.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Product', 'Category', 'Price', 'Available'].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', opacity: p.available ? 1 : 0.45 }}>
                    <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p.category}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {/* Read-only — prices are managed in the Canyon dashboard */}
                      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        ${p.price.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button
                        onClick={() => toggleSoldOut(p.id, p.available)}
                        disabled={savingSoldOut === p.id}
                        style={{
                          padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                          border: 'none', cursor: savingSoldOut === p.id ? 'wait' : 'pointer',
                          opacity: savingSoldOut === p.id ? 0.6 : 1,
                          background: p.available ? 'var(--green-dim)' : 'rgba(220,38,38,0.15)',
                          color: p.available ? 'var(--green)' : 'var(--red)',
                        }}
                      >
                        {savingSoldOut === p.id ? 'Saving…' : p.available ? '✓ Available' : '✕ Sold Out'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Settings tab ── */}
        {tab === 'settings' && (
          <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[
              { label: 'Machine ID', key: 'machineId', type: 'select', options: MACHINE_IDS },
              { label: 'Location Name', key: 'locationName', type: 'text' },
              { label: 'Partner Name (optional)', key: 'partnerName', type: 'text' },
              { label: 'Admin PIN', key: 'adminPin', type: 'text' },
            ].map(({ label, key, type, options }) => (
              <div key={key}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  {label}
                </div>
                {type === 'select' ? (
                  <select
                    value={(draft as unknown as Record<string, string>)[key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    style={{ width: '100%', padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'white', fontSize: 15 }}
                  >
                    {options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={(draft as unknown as Record<string, string>)[key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    style={{ width: '100%', padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'white', fontSize: 15 }}
                  />
                )}
              </div>
            ))}

            <button onClick={saveSettings} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0', background: 'var(--ember)', border: 'none', color: 'white',
              borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>
              <Save size={16} /> Save Settings
            </button>

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

              {fixableProducts.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Found in inventory but not assigned — tap to add:
                  </div>
                  {fixableProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => fixAssignment(p.id, p.name)}
                      disabled={fixing === p.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', background: 'rgba(34,197,94,0.1)',
                        border: '1px solid rgba(34,197,94,0.4)', borderRadius: 8,
                        color: '#86efac', cursor: fixing === p.id ? 'wait' : 'pointer', fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span style={{ opacity: 0.7, fontSize: 11 }}>
                        {fixing === p.id ? 'Adding…' : '＋ Add to This Machine'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
