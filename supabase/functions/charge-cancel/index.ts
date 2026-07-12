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

    // Look up THIS reference's payment row FIRST so every action below can be scoped
    // to it — a cancel must never touch a different customer's in-flight payment.
    const { data: row } = await supabase
      .from('payment_results')
      .select('transaction_id, status')
      .eq('reference_id', referenceId)
      .maybeSingle()

    const { data: machine } = await supabase
      .from('machines')
      .select('stripe_reader_id')
      .eq('code', machineId ?? '')
      .maybeSingle()

    // (F6) Clear the reader ONLY if the action currently on it belongs to THIS
    // reference. Previously cancelAction fired unconditionally, so a stale/delayed
    // cancel — or a forged request with just a machineId — wiped whatever payment
    // the NEXT customer had already armed. Scope it to our own PaymentIntent.
    if (machine?.stripe_reader_id && row?.transaction_id) {
      try {
        const reader = await stripe.terminal.readers.retrieve(machine.stripe_reader_id)
        // deno-lint-ignore no-explicit-any
        const action = reader.action as any
        const onReaderPi = action?.process_payment_intent?.payment_intent
        if (onReaderPi === row.transaction_id) {
          await stripe.terminal.readers.cancelAction(machine.stripe_reader_id)
        }
      } catch (e) {
        console.warn('reader cancel skipped:', e)
      }
    }

    // Resolve the PaymentIntent. Only act while our row is still PENDING.
    if (row?.transaction_id && row.status === 'PENDING') {
      let piSucceeded = false
      try {
        const canceled = await stripe.paymentIntents.cancel(row.transaction_id)
        piSucceeded = canceled.status === 'succeeded' // normally 'canceled'; belt-and-braces
      } catch (_e) {
        // (F1) cancel() THROWS when the PI already SUCCEEDED — the exact race where the
        // card was tapped at ~89s just as the 90s timeout fired the cancel. Do NOT blindly
        // mark CANCELED (that erases a captured sale and invites a double charge). Retrieve
        // the PI and find out what really happened.
        try {
          const pi = await stripe.paymentIntents.retrieve(row.transaction_id)
          piSucceeded = pi.status === 'succeeded'
        } catch (e2) {
          console.warn('PI retrieve after failed cancel:', e2)
        }
      }

      if (piSucceeded) {
        // (F1) Money WAS captured — record PROCESSED (guarded), never CANCELED, and tell
        // the client so it shows approval instead of a false timeout.
        const nowIso = new Date().toISOString()
        await supabase.from('payment_results')
          .update({ status: 'PROCESSED', updated_at: nowIso })
          .eq('reference_id', referenceId)
          .eq('status', 'PENDING')
        await supabase.from('kiosk_sales')
          .update({ status: 'PROCESSED', completed_at: nowIso })
          .eq('id', referenceId)
          .eq('status', 'PENDING')
        return new Response(JSON.stringify({ ok: true, status: 'PROCESSED' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Genuinely canceled — flip both rows, each guarded with .eq('status','PENDING')
      // (F1) so a concurrent webhook PROCESSED write can never be clobbered back to CANCELED.
      await supabase.from('payment_results')
        .update({ status: 'CANCELED' })
        .eq('reference_id', referenceId)
        .eq('status', 'PENDING')
      await supabase.from('kiosk_sales')
        .update({ status: 'CANCELED', completed_at: null })
        .eq('id', referenceId)
        .eq('status', 'PENDING')
    }

    return new Response(JSON.stringify({ ok: true, status: row?.status ?? 'UNKNOWN' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('charge-cancel error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
