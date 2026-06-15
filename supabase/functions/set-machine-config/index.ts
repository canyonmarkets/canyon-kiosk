import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Only these two keys may be written — prevents use as an open write proxy
const ALLOWED_KEYS = new Set(['machineHidden', 'machineProductIds'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { key, machineId, value } = await req.json() as {
      key: string
      machineId: string
      value: unknown
    }

    if (!ALLOWED_KEYS.has(key)) {
      return new Response(JSON.stringify({ error: `key "${key}" not permitted` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!machineId || typeof machineId !== 'string') {
      return new Response(JSON.stringify({ error: 'machineId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Read-modify-write: only touch the slot for this machineId
    const { data: row } = await sb
      .from('app_config').select('value').eq('key', key).maybeSingle()
    const all = (row?.value ?? {}) as Record<string, unknown>
    const updated = { ...all, [machineId]: value }

    const { error } = await sb
      .from('app_config').upsert({ key, value: updated })

    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
