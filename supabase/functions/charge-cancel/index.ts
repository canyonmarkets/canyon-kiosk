import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { referenceId, machineId } = await req.json()
    if (!referenceId) {
      return new Response(JSON.stringify({ error: 'referenceId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const stripe   = new Stripe(STRIPE_SECRET_KEY)

    // Look up the reader for this machine
    const { data: machine } = await supabase
      .from('machines')
      .select('stripe_reader_id')
      .eq('code', machineId ?? '')
      .maybeSingle()

    // Cancel the reader action so the terminal clears immediately
    if (machine?.stripe_reader_id) {
      try {
        await stripe.terminal.readers.cancelAction(machine.stripe_reader_id)
      } catch (e) {
        // Reader may have already cleared (timed out, card removed) — not fatal
        console.warn('cancelAction skipped:', e)
      }
    }

    // Cancel the PaymentIntent if one exists for this reference
    const { data: row } = await supabase
      .from('payment_results')
      .select('transaction_id, status')
      .eq('reference_id', referenceId)
      .maybeSingle()

    if (row?.transaction_id && row.status === 'PENDING') {
      try {
        await stripe.paymentIntents.cancel(row.transaction_id)
      } catch (e) {
        console.warn('PaymentIntent cancel skipped:', e)
      }
      await supabase
        .from('payment_results')
        .update({ status: 'CANCELED' })
        .eq('reference_id', referenceId)
    }

    // Also flip the bridge row so it is not left dangling as PENDING forever.
    // (Only ever touches our own still-pending row; PROCESSED rows are untouched.)
    await supabase
      .from('kiosk_sales')
      .update({ status: 'CANCELED', completed_at: null })
      .eq('id', referenceId)
      .eq('status', 'PENDING')

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('charge-cancel error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
