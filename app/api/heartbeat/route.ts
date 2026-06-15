import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ─── Heartbeat endpoint ───────────────────────────────────────────────────────
// Each kiosk POSTs here every 5 minutes (see app/page.tsx). We upsert the machine's
// last_seen into machine_heartbeats; the vending-dash dashboard flags a machine
// "offline" when last_seen is older than ~10 minutes.
//
// Uses the publishable (anon) key — same as the rest of the kiosk; machine_heartbeats
// has a permissive policy since it holds no sensitive data.

const SUPABASE_URL = 'https://zgmxmficzvlpzkosdcnx.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_MUAaPltQkyDFsR0NvLTikQ_gY_pfJFy'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function POST(req: NextRequest) {
  try {
    const { machineId } = await req.json()
    if (!machineId) return NextResponse.json({ error: 'machineId required' }, { status: 400 })

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('machine_heartbeats')
      .upsert({ machine_code: machineId, last_seen: now, updated_at: now })
    if (error) console.warn('[heartbeat] upsert failed:', error.message)

    return NextResponse.json({ ok: true, machineId, receivedAt: now })
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}
