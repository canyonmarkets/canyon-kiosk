import { createClient } from 'npm:@supabase/supabase-js@2'

// pantry-checkout — records a pantry kiosk checkout into the shared
// kiosk_sales pipeline. kiosk_sales is RLS'd service-role-only, so the kiosk's
// anon client can't insert directly; this function is the write path.
// Deployed with --no-verify-jwt (like the charge family) — the kiosk posts
// with no auth. Idempotent via the kiosk_sales primary key: a duplicate id
// (23505) means a previous attempt landed but the kiosk died before marking
// the record synced, so it's returned as success and the retry loop stops.

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CheckoutItem {
  productId: string
  name: string
  qty: number
  unitPrice: number
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { referenceId, siteCode, items } = await req.json()

    // ── Validation ─────────────────────────────────────────────────────────
    if (!referenceId || typeof referenceId !== 'string') {
      return json({ error: 'referenceId required' }, 400)
    }
    if (!siteCode || typeof siteCode !== 'string') {
      return json({ error: 'siteCode required' }, 400)
    }
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: 'items must be a non-empty array' }, 400)
    }
    for (const item of items as CheckoutItem[]) {
      if (!item || typeof item.productId !== 'string' || !item.productId) {
        return json({ error: 'each item requires a productId' }, 400)
      }
      if (typeof item.qty !== 'number' || !Number.isFinite(item.qty) || item.qty <= 0) {
        return json({ error: `non-positive qty for ${item.productId}` }, 400)
      }
      if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        return json({ error: `invalid unitPrice for ${item.productId}` }, 400)
      }
    }

    // ── Insert into the shared sales pipeline ──────────────────────────────
    // Pantry sites: no card charge, no tax — the "sale" is a consumption record
    // billed monthly at sellPrice. Status PROCESSED so the dash's kiosk sync
    // ingests it into sale_records (source Pantry) and decrements on-hand.
    const subtotal = Math.round(
      (items as CheckoutItem[]).reduce((sum, i) => sum + i.qty * i.unitPrice, 0) * 100
    ) / 100

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { error } = await supabase.from('kiosk_sales').insert({
      id: referenceId,
      machine_code: siteCode,
      items: (items as CheckoutItem[]).map(i => ({
        productId: i.productId,
        name: i.name ?? '',
        qty: i.qty,
        unitPrice: i.unitPrice,
      })),
      subtotal,
      tax: 0,
      total: subtotal,
      status: 'PROCESSED',
    })

    if (error) {
      // 23505 = duplicate primary key — this checkout already landed on a
      // prior attempt. Success, so the kiosk marks it synced and stops retrying.
      if (error.code === '23505') return json({ ok: true, referenceId, duplicate: true })
      console.error('kiosk_sales insert failed:', error)
      return json({ error: error.message }, 500)
    }

    return json({ ok: true, referenceId })
  } catch (err) {
    console.error('pantry-checkout error:', err)
    return json({ error: String(err) }, 400)
  }
})
