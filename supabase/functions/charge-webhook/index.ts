import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// This function receives Poynt's POST-back after a payment is processed or cancelled.
// Deployed with --no-verify-jwt so Poynt can POST without a Supabase JWT.
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  // Authenticity: this endpoint runs --no-verify-jwt so Poynt can POST to it, which
  // means anyone could otherwise POST {referenceId, status:'PROCESSED'} and flip a
  // pending charge to approved (a free-checkout hole — referenceIds are guessable).
  // The charge fn appends ?token=WEBHOOK_SECRET to the callbackUrl; require it to
  // match when the secret is configured. (No secret set = legacy open behavior.)
  const expectedSecret = Deno.env.get('WEBHOOK_SECRET') ?? ''
  if (expectedSecret) {
    const token = new URL(req.url).searchParams.get('token')
    if (token !== expectedSecret) {
      return new Response('unauthorized', { status: 401 })
    }
  }

  try {
    const body = await req.json()
    // Poynt callback shape: { referenceId, status: 'PROCESSED'|'CANCELED', transactions: [...] }
    const { referenceId, status, transactions } = body

    if (!referenceId || !status) {
      return new Response('missing referenceId or status', { status: 400 })
    }

    const transactionId = transactions?.[0]?.id ?? null

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { error } = await supabase
      .from('payment_results')
      .update({ status, transaction_id: transactionId, updated_at: new Date().toISOString() })
      .eq('reference_id', referenceId)

    if (error) throw error

    // Confirm the bridge row written by `charge` so vending-dash can ingest it.
    // This is the authoritative server-side confirmation — it lands even if the
    // kiosk client already timed out / moved on. completed_at is set on PROCESSED.
    const { error: ksErr } = await supabase
      .from('kiosk_sales')
      .update({ status, completed_at: status === 'PROCESSED' ? new Date().toISOString() : null })
      .eq('id', referenceId)
    if (ksErr) console.error('kiosk_sales status update failed:', ksErr)

    // Must return 200 quickly — Poynt retries at 3s, 5s, 10s if it doesn't get 200
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('webhook error:', err)
    return new Response(String(err), { status: 500 })
  }
})
