import { NextRequest, NextResponse } from 'next/server'

// ─── Heartbeat endpoint ───────────────────────────────────────────────────────
// Each kiosk POSTs here every 5 minutes.
// In Phase 2 (Supabase) this will write to a machine_heartbeats table
// and trigger an alert if a machine hasn't pinged in > 10 minutes.
//
// For now: logs the ping and returns 200 OK.
// TODO: add email/SMS alert when a machine goes silent.

export async function POST(req: NextRequest) {
  try {
    const { machineId, ts } = await req.json()
    console.log(`[heartbeat] ${machineId} — ${ts}`)

    // TODO Phase 2: upsert to Supabase + check last_seen gap

    return NextResponse.json({ ok: true, machineId, receivedAt: new Date().toISOString() })
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}
