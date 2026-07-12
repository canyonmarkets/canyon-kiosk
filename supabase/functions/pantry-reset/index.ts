import { createClient } from 'npm:@supabase/supabase-js@2'

// pantry-reset — wipes a single PANTRY site's consumption history so Jeff can
// sandbox freely before go-live: deletes the site's kiosk_sales rows, their
// sale_records + dedup keys, and restores the site's on-hand to par.
//
// SAFETY RAILS:
//  - Refuses any machine whose type !== 'pantry' (market data untouchable).
//  - Requires a valid authenticated dash user: caller passes their Supabase
//    access token; we verify it with auth.getUser() before doing anything.
// Deployed with --no-verify-jwt (kiosk-family pattern); auth enforced in-body.

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { siteCode, accessToken } = await req.json()
    if (!siteCode || typeof siteCode !== 'string') return json({ error: 'siteCode required' }, 400)
    if (!accessToken || typeof accessToken !== 'string') return json({ error: 'accessToken required' }, 401)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── Rail 1: caller must be a real authenticated user ────────────────────
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken)
    if (userErr || !userData?.user) return json({ error: 'not authenticated' }, 401)

    // ── Rail 2: target must be a pantry-type machine ────────────────────────
    const { data: machine } = await supabase
      .from('machines')
      .select('id, code, type')
      .eq('code', siteCode)
      .maybeSingle()
    if (!machine) return json({ error: `no machine with code ${siteCode}` }, 404)
    if (machine.type !== 'pantry') {
      return json({ error: `${siteCode} is not a pantry site — reset refused` }, 403)
    }

    // ── Collect this site's kiosk_sales ids (dedup keys derive from them) ──
    const { data: sales } = await supabase
      .from('kiosk_sales')
      .select('id')
      .eq('machine_code', machine.code)
    const saleIds = (sales ?? []).map((r: { id: string }) => r.id)

    // ── Delete sale_records + dedup keys + kiosk_sales for this site only ──
    const { count: recordsDeleted } = await supabase
      .from('sale_records')
      .delete({ count: 'exact' })
      .eq('machineCode', machine.code)

    let dedupDeleted = 0
    for (const id of saleIds) {
      const { count } = await supabase
        .from('imported_dedup_keys')
        .delete({ count: 'exact' })
        .like('dedupKey', `KIOSK_${id}_%`)
      dedupDeleted += count ?? 0
    }

    const { count: salesDeleted } = await supabase
      .from('kiosk_sales')
      .delete({ count: 'exact' })
      .eq('machine_code', machine.code)

    // ── Restore on-hand to par for this site ───────────────────────────────
    const { data: cfgRows } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['machineProductPar', 'machineProductOnHand'])
    const parMap = cfgRows?.find((r: { key: string }) => r.key === 'machineProductPar')?.value?.[machine.id] ?? {}
    const onHandAll = cfgRows?.find((r: { key: string }) => r.key === 'machineProductOnHand')?.value ?? {}
    onHandAll[machine.id] = { ...parMap }
    await supabase.from('app_config').upsert({ key: 'machineProductOnHand', value: onHandAll })

    return json({
      ok: true,
      siteCode: machine.code,
      saleRecordsDeleted: recordsDeleted ?? 0,
      kioskSalesDeleted: salesDeleted ?? 0,
      dedupKeysDeleted: dedupDeleted,
      onHandRestoredToPar: Object.keys(parMap).length,
    })
  } catch (err) {
    console.error('pantry-reset error:', err)
    return json({ error: String(err) }, 400)
  }
})
