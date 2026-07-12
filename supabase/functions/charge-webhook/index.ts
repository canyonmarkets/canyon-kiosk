import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Deployed --no-verify-jwt so Stripe can POST without a Supabase JWT.
// Authenticity is guaranteed by Stripe-Signature header verification instead.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('missing stripe-signature', { status: 400 })

  // Raw body must be read before any parsing for signature verification
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY)
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe signature verification failed:', err)
    return new Response(`Webhook Error: ${err}`, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      const referenceId = pi.metadata?.referenceId
      if (referenceId) {
        const nowIso = new Date().toISOString()
        const r1 = await supabase.from('payment_results')
          .update({ status: 'PROCESSED', updated_at: nowIso })
          .eq('reference_id', referenceId)
        const r2 = await supabase.from('kiosk_sales')
          .update({ status: 'PROCESSED', completed_at: nowIso })
          .eq('id', referenceId)
        // (F8) If either write fails, THROW so the catch returns 500 and Stripe retries.
        // The updates are idempotent status writes, so a retry only re-applies the same
        // terminal state — losing a PROCESSED transition (money captured, sale not recorded)
        // is far worse than a duplicate delivery.
        if (r1.error || r2.error) {
          throw new Error(`PROCESSED write failed: ${r1.error?.message ?? ''} ${r2.error?.message ?? ''}`)
        }
      }

    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent
      const referenceId = pi.metadata?.referenceId
      if (referenceId) {
        await supabase.from('payment_results')
          .update({ status: 'CANCELED', updated_at: new Date().toISOString() })
          .eq('reference_id', referenceId)
        await supabase.from('kiosk_sales')
          .update({ status: 'CANCELED', completed_at: null })
          .eq('id', referenceId)
      }

    } else if (event.type === 'terminal.reader.action_failed') {
      // Look up referenceId via the PaymentIntent ID stored in transaction_id
      const reader = event.data.object as Stripe.Terminal.Reader
      const piId = (reader.action as Record<string, unknown> | null)
        ?.process_payment_intent as Record<string, string> | undefined
        // deno-lint-ignore no-explicit-any
      const paymentIntentId = (piId as any)?.payment_intent
      if (paymentIntentId) {
        const { data: pr } = await supabase
          .from('payment_results')
          .select('reference_id')
          .eq('transaction_id', paymentIntentId)
          .maybeSingle()
        if (pr?.reference_id) {
          await Promise.all([
            supabase.from('payment_results')
              .update({ status: 'CANCELED', updated_at: new Date().toISOString() })
              .eq('reference_id', pr.reference_id),
            supabase.from('kiosk_sales')
              .update({ status: 'CANCELED', completed_at: null })
              .eq('id', pr.reference_id),
          ])
        }
      }
    }

  } catch (err) {
    console.error('webhook processing error:', err)
    // (F8) Return 500 so Stripe RETRIES. Our status writes are idempotent (same-value
    // terminal-state writes), so a retry can only re-apply the same result — whereas the
    // old 200-on-error swallowed a transient DB failure and permanently lost the
    // PROCESSED/CANCELED transition after the kiosk had already stopped polling.
    return new Response(`processing error: ${err}`, { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
