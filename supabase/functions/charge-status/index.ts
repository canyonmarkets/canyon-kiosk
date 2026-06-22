import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
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
    .select('status, transaction_id, created_at')
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

  // Webhook-miss backstop: the kiosk's "approved" decision normally depends
  // entirely on the Stripe webhook flipping this row to PROCESSED. If that
  // webhook is delayed or dropped, a charged customer would be stuck on
  // "processing" and the kiosk would time out -- telling them it failed while
  // their card was charged. So once a payment has been PENDING for a few
  // seconds we ask Stripe directly and self-heal the row to match reality.
  if (data.status === 'PENDING' && data.transaction_id) {
    const ageMs = Date.now() - new Date(data.created_at).getTime()
    if (ageMs > 10000) {
      try {
        const stripe = new Stripe(STRIPE_SECRET_KEY)
        const pi = await stripe.paymentIntents.retrieve(data.transaction_id)
        const now = new Date().toISOString()
        if (pi.status === 'succeeded') {
          await supabase.from('payment_results')
            .update({ status: 'PROCESSED', updated_at: now }).eq('reference_id', referenceId)
          await supabase.from('kiosk_sales')
            .update({ status: 'PROCESSED', completed_at: now }).eq('id', referenceId)
          return new Response(JSON.stringify({ status: 'PROCESSED', transactionId: data.transaction_id, source: 'stripe' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        if (pi.status === 'canceled') {
          await supabase.from('payment_results')
            .update({ status: 'CANCELED', updated_at: now }).eq('reference_id', referenceId)
          await supabase.from('kiosk_sales')
            .update({ status: 'CANCELED', completed_at: null }).eq('id', referenceId)
          return new Response(JSON.stringify({ status: 'CANCELED', transactionId: data.transaction_id, source: 'stripe' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        // requires_payment_method / processing / requires_action: genuinely still pending
      } catch (e) {
        console.error('charge-status stripe fallback failed:', e)
      }
    }
  }

  return new Response(JSON.stringify({ status: data.status, transactionId: data.transaction_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
