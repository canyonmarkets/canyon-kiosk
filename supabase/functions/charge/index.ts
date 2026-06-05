import { createClient } from 'npm:@supabase/supabase-js@2'

const POYNT_API = 'https://services.poynt.net'
const APP_ID = Deno.env.get('POYNT_APP_ID')!
const PRIVATE_KEY_PEM = Deno.env.get('POYNT_PRIVATE_KEY')!
const BUSINESS_ID = Deno.env.get('POYNT_BUSINESS_ID')!
const STORE_ID = Deno.env.get('POYNT_STORE_ID')!
const DEVICE_ID = Deno.env.get('POYNT_DEVICE_ID')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/charge-webhook`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Convert PKCS#1 RSA private key PEM to PKCS#8 DER for Web Crypto API
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  function encLen(n: number): Uint8Array {
    if (n < 128) return new Uint8Array([n])
    const b: number[] = []
    let x = n
    while (x > 0) { b.unshift(x & 0xff); x >>= 8 }
    return new Uint8Array([0x80 | b.length, ...b])
  }
  function wrap(tag: number, content: Uint8Array): Uint8Array {
    return new Uint8Array([tag, ...encLen(content.length), ...content])
  }
  const version = new Uint8Array([0x02, 0x01, 0x00])
  // OID 1.2.840.113549.1.1.1 (rsaEncryption) + NULL
  const oid = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])
  const algId = wrap(0x30, oid)
  const privateKey = wrap(0x04, pkcs1)
  return wrap(0x30, new Uint8Array([...version, ...algId, ...privateKey]))
}

async function importPrivateKey(): Promise<CryptoKey> {
  const pem = PRIVATE_KEY_PEM
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const pkcs1Der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const pkcs8Der = pkcs1ToPkcs8(pkcs1Der)
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8Der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getPoyntAccessToken(key: CryptoKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: APP_ID,
    sub: APP_ID,
    aud: POYNT_API,
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  })))
  const signingInput = `${header}.${payload}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${b64url(sig)}`

  const res = await fetch(`${POYNT_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'api-version': '1.2' },
    body: `grantType=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
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

    // Auth with Poynt
    const privateKey = await importPrivateKey()
    const accessToken = await getPoyntAccessToken(privateKey)

    // Send payment request to terminal via Cloud Messages
    const paymentData = JSON.stringify({
      action: 'sale',
      purchaseAmount: amountCents,
      tipAmount: 0,
      currency: 'USD',
      referenceId,
      callbackUrl: WEBHOOK_URL,
    })

    const cloudMessageRes = await fetch(
      `${POYNT_API}/businesses/${BUSINESS_ID}/cloudMessages`,
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

    // Record pending payment in DB
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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
