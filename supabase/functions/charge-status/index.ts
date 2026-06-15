import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const referenceId = url.searchParams.get('ref')
  if (!referenceId) {
    return new Response(JSON.stringify({ error: 'ref param required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('payment_results')
    .select('status, transaction_id')
    .eq('reference_id', referenceId)
    .maybeSingle()

  if (error) {
    return new Response(JSON.stringify({ status: 'ERROR', error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  if (!data) {
    return new Response(JSON.stringify({ status: 'NOT_FOUND' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ status: data.status, transactionId: data.transaction_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
