import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { amountCents, referenceId, machineId, items, subtotal, tax, _testDecline } = await req.json()
    if (!amountCents || !referenceId) {
      return new Response(JSON.stringify({ error: 'amountCents and referenceId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Look up the reader for this machine
    const { data: machine, error: machineErr } = await supabase
      .from('machines')
      .select('stripe_reader_id, name')
      .eq('code', machineId ?? '')
      .maybeSingle()
    if (machineErr || !machine?.stripe_reader_id) {
      return new Response(JSON.stringify({ error: `No reader configured for machine: ${machineId}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const STRIPE_READER_ID = machine.stripe_reader_id

    // Idempotency guard: if a payment row already exists for this referenceId,
    // return its current status without creating a second PaymentIntent.
    // Prevents double-charging if the kiosk retries a request (network fluke,
    // same-millisecond timestamp collision, etc.).
    const { data: existing } = await supabase
      .from('payment_results')
      .select('status')
      .eq('reference_id', referenceId)
      .maybeSingle()
    if (existing) {
      return new Response(JSON.stringify({ referenceId, status: existing.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY)

    // 1. Create a PaymentIntent for card-present (terminal) payment
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { referenceId, machineId: machineId ?? '' },
    })

    // 2. Send the payment to the terminal reader
    await stripe.terminal.readers.processPaymentIntent(STRIPE_READER_ID, {
      payment_intent: pi.id,
    })

    // In test mode, simulate a card tap so the payment auto-completes.
    // _testDecline=true simulates a declined card (for testing the cancel flow).
    // In production this block is never reached (sk_live_ key).
    if (STRIPE_SECRET_KEY.startsWith('sk_test_')) {
      if (_testDecline) {
        await stripe.testHelpers.terminal.readers.presentPaymentMethod(STRIPE_READER_ID, {
          type: 'card_present',
          card_present: { number: '4000000000000002' },
        })
      } else {
        await stripe.testHelpers.terminal.readers.presentPaymentMethod(STRIPE_READER_ID)
      }
    }

    // 3. Record the pending charge — transaction_id holds the Stripe PaymentIntent ID
    await supabase.from('payment_results').insert({
      reference_id: referenceId,
      status: 'PENDING',
      amount_cents: amountCents,
      machine_id: machineId ?? null,
      transaction_id: pi.id,
    })

    // 4. Bridge: persist cart so vending-dash can ingest on confirmation.
    //    Never let a bridge failure block the payment response.
    if (Array.isArray(items) && items.length > 0) {
      const { error: ksErr } = await supabase.from('kiosk_sales').insert({
        id: referenceId,
        machine_code: machineId ?? null,
        items,
        subtotal: subtotal ?? (amountCents / 100),
        tax: tax ?? 0,
        total: amountCents / 100,
        status: 'PENDING',
      })
      if (ksErr) console.error('kiosk_sales insert failed (payment still proceeds):', ksErr)
    }

    return new Response(JSON.stringify({ referenceId, status: 'PENDING' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('charge error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
