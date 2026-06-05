import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// This function receives Poynt's POST-back after a payment is processed or cancelled.
// Deployed with --no-verify-jwt so Poynt can POST without a Supabase JWT.
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
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

    // Must return 200 quickly — Poynt retries at 3s, 5s, 10s if it doesn't get 200
    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('webhook error:', err)
    return new Response(String(err), { status: 500 })
  }
})
