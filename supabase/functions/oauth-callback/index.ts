import { createClient } from 'npm:@supabase/supabase-js@2'
import { importPKCS8, SignJWT } from 'npm:jose@5'

const POYNT_API = 'https://services.poynt.net'
const APP_ID = Deno.env.get('POYNT_APP_ID') || 'urn:aid:f4f01b8d-9abb-4677-88d0-71c3302a3b53'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/oauth-callback`

const PRIVATE_KEY_PEM = Deno.env.get('POYNT_PRIVATE_KEY')!

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

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const businessId = url.searchParams.get('businessId')
  const error = url.searchParams.get('error')

  if (error) {
    return new Response(`<html><body><h2>Authorization failed: ${error}</h2></body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  if (!code || !businessId) {
    return new Response(`<html><body><h2>Missing code or businessId</h2><pre>${url.search}</pre></body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  try {
    const appJWT = await makeAppJWT()

    // Exchange auth code for access + refresh tokens
    const tokenRes = await fetch(`${POYNT_API}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${appJWT}`,
        'api-version': '1.2',
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(APP_ID)}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}`,
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok || !tokenData.accessToken) {
      return new Response(`<html><body><h2>Token exchange failed</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre></body></html>`, {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    // Store the refresh token in Supabase for reuse
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    await supabase.from('poynt_tokens').upsert({
      id: 1,
      business_id: businessId,
      refresh_token: tokenData.refreshToken,
      access_token: tokenData.accessToken,
      updated_at: new Date().toISOString(),
    })

    return new Response(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:600px">
        <h2 style="color:green">✅ Authorization successful!</h2>
        <p><strong>Business ID:</strong> ${businessId}</p>
        <p><strong>Access Token:</strong> obtained ✅</p>
        <p><strong>Refresh Token:</strong> ${tokenData.refreshToken ? 'stored ✅' : 'not provided ⚠️'}</p>
        <p>You can close this tab. The Canyon Kiosk is now authorized to process payments.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })

  } catch (err) {
    return new Response(`<html><body><h2>Error</h2><pre>${String(err)}</pre></body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    })
  }
})
