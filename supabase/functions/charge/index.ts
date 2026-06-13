import { createClient } from 'npm:@supabase/supabase-js@2'
import { importPKCS8, SignJWT } from 'npm:jose@5'

const POYNT_API = 'https://services.poynt.net'
const APP_ID = Deno.env.get('POYNT_APP_ID') || 'urn:aid:f4f01b8d-9abb-4677-88d0-71c3302a3b53'
const BUSINESS_ID = Deno.env.get('POYNT_BUSINESS_ID') || '84068c23-6ed2-4114-9a87-07cd3dd58ce7'
const STORE_ID = Deno.env.get('POYNT_STORE_ID') || '69d9d6e7-5813-431f-bc4c-058d210faf01'
const DEVICE_ID = Deno.env.get('POYNT_DEVICE_ID') || '6e07c9af-e666-4019-9ebd-16645c4338c0'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/charge-webhook`

const PRIVATE_KEY_PEM = Deno.env.get('POYNT_PRIVATE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function makeAppJWT(): Promise<string> {
  const privateKey = await importPKCS8(PRIVATE_KEY_PEM, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(APP_ID)
    .setSubject(APP_ID)
    .setAudience(POYNT_API)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(crypto.randomUUID())
    .sign(privateKey)
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

async function getPoyntAccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const appJWT = await makeAppJWT()

  // Merchant token stored by oauth-callback (production Canyon Markets grant)
  const { data: row } = await supabase.from('poynt_tokens').select('*').eq('id', 1).maybeSingle()

  if (row?.access_token) {
    const claims = decodeJwtPayload(row.access_token)
    const exp = typeof claims?.exp === 'number' ? claims.exp : 0
    if (exp > Date.now() / 1000 + 60) return row.access_token

    if (row.refresh_token) {
      const res = await fetch(`${POYNT_API}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${appJWT}`,
          'api-version': '1.2',
        },
        body: `grant_type=refresh_token&client_id=${encodeURIComponent(APP_ID)}&refresh_token=${encodeURIComponent(row.refresh_token)}`,
      })
      const data = await res.json()
      if (res.ok && data.accessToken) {
        await supabase.from('poynt_tokens').upsert({
          id: 1,
          business_id: row.business_id,
          access_token: data.accessToken,
          refresh_token: data.refreshToken ?? row.refresh_token,
          updated_at: new Date().toISOString(),
        })
        return data.accessToken
      }
      console.error('Token refresh failed:', JSON.stringify(data))
    }
  }

  // Fallback: app-level JWT bearer token scoped to business
  const res = await fetch(`${POYNT_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'api-version': '1.2' },
    body: `grantType=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(appJWT)}&businessId=${encodeURIComponent(BUSINESS_ID)}`,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Poynt auth failed: ${JSON.stringify(data)}`)
  return data.accessToken
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { amountCents, referenceId, machineId } = await req.json()
    if (!amountCents || !referenceId) {
      return new Response(JSON.stringify({ error: 'amountCents and referenceId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const accessToken = await getPoyntAccessToken(supabase)

    const paymentData = JSON.stringify({
      action: 'sale',
      purchaseAmount: amountCents,
      tipAmount: 0,
      currency: 'USD',
      referenceId,
      callbackUrl: WEBHOOK_URL,
    })

    const cloudMessageRes = await fetch(
      `${POYNT_API}/cloudMessages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `BEARER ${accessToken}`,
          'Content-Type': 'application/json',
          'api-version': '1.2',
        },
        body: JSON.stringify({
          ttl: 90,
          businessId: BUSINESS_ID,
          storeId: STORE_ID,
          deviceId: DEVICE_ID,
          data: paymentData,
        }),
      }
    )

    if (!cloudMessageRes.ok) {
      const err = await cloudMessageRes.text()
      throw new Error(`Poynt cloudMessages failed: ${err}`)
    }

    await supabase.from('payment_results').insert({
      reference_id: referenceId,
      status: 'PENDING',
      amount_cents: amountCents,
      machine_id: machineId ?? null,
    })

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
