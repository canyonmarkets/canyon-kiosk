import { createClient } from 'npm:@supabase/supabase-js@2'
import { importPKCS8, SignJWT } from 'npm:jose@5'

const POYNT_API = 'https://services.poynt.net'
const APP_ID = Deno.env.get('POYNT_APP_ID') || 'urn:aid:f4f01b8d-9abb-4677-88d0-71c3302a3b53'
const BUSINESS_ID = Deno.env.get('POYNT_BUSINESS_ID') || ''
const STORE_ID = Deno.env.get('POYNT_STORE_ID') || ''
const DEVICE_ID = Deno.env.get('POYNT_DEVICE_ID') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const PRIVATE_KEY_PEM = Deno.env.get('POYNT_PRIVATE_KEY')!

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
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

const safeJson = async (res: Response) => {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text.slice(0, 600) }
}

Deno.serve(async () => {
  const report: Record<string, unknown> = {}
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const appJWT = await makeAppJWT()

    // 1. Inspect stored merchant token
    const { data: row, error: rowErr } = await supabase.from('poynt_tokens').select('*').eq('id', 1).maybeSingle()
    report.storedRowFound = !!row
    report.storedRowError = rowErr ? String(rowErr.message) : null
    if (!row?.access_token) {
      return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } })
    }

    report.storedBusinessId = row.business_id
    report.hasRefreshToken = !!row.refresh_token
    const storedClaims = decodeJwtPayload(row.access_token)
    report.storedAccessClaims = storedClaims
    const exp = typeof storedClaims?.exp === 'number' ? storedClaims.exp : 0
    const now = Date.now() / 1000
    report.accessTokenExpiresInSeconds = Math.round(exp - now)

    // 2. Get a usable merchant token (refresh if expired)
    let merchantToken: string | null = exp > now + 60 ? row.access_token : null
    if (!merchantToken && row.refresh_token) {
      const r1 = await fetch(`${POYNT_API}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${appJWT}`,
          'api-version': '1.2',
        },
        body: `grant_type=refresh_token&client_id=${encodeURIComponent(APP_ID)}&refresh_token=${encodeURIComponent(row.refresh_token)}`,
      })
      const d1 = await safeJson(r1)
      report.refreshSnakeStatus = r1.status
      if (r1.ok && (d1 as Record<string, unknown>)?.accessToken) {
        merchantToken = (d1 as Record<string, string>).accessToken
        report.refreshWorked = 'snake_case'
        await supabase.from('poynt_tokens').upsert({
          id: 1,
          business_id: row.business_id,
          access_token: merchantToken,
          refresh_token: (d1 as Record<string, string>).refreshToken ?? row.refresh_token,
          updated_at: new Date().toISOString(),
        })
      } else {
        report.refreshSnakeBody = d1
        const r2 = await fetch(`${POYNT_API}/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${appJWT}`,
            'api-version': '1.2',
          },
          body: `grantType=REFRESH_TOKEN&clientId=${encodeURIComponent(APP_ID)}&refreshToken=${encodeURIComponent(row.refresh_token)}`,
        })
        const d2 = await safeJson(r2)
        report.refreshCamelStatus = r2.status
        if (r2.ok && (d2 as Record<string, unknown>)?.accessToken) {
          merchantToken = (d2 as Record<string, string>).accessToken
          report.refreshWorked = 'camelCase'
          await supabase.from('poynt_tokens').upsert({
            id: 1,
            business_id: row.business_id,
            access_token: merchantToken,
            refresh_token: (d2 as Record<string, string>).refreshToken ?? row.refresh_token,
            updated_at: new Date().toISOString(),
          })
        } else {
          report.refreshCamelBody = d2
        }
      }
    }

    report.merchantTokenUsable = !!merchantToken
    if (!merchantToken) {
      return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } })
    }
    report.merchantTokenClaims = decodeJwtPayload(merchantToken)

    // 3. Can the merchant token see the production business?
    const bizRes = await fetch(`${POYNT_API}/businesses/${BUSINESS_ID}`, {
      headers: { 'Authorization': `BEARER ${merchantToken}`, 'api-version': '1.2' },
    })
    const biz = await safeJson(bizRes)
    report.bizGetStatus = bizRes.status
    report.bizGetSummary = bizRes.ok
      ? { id: (biz as Record<string, unknown>).id, doingBusinessAs: (biz as Record<string, unknown>).doingBusinessAs, status: (biz as Record<string, unknown>).status }
      : biz

    // 4. Enumerate stores and devices with the merchant token (first time we can!)
    const storesRes = await fetch(`${POYNT_API}/businesses/${BUSINESS_ID}/stores`, {
      headers: { 'Authorization': `BEARER ${merchantToken}`, 'api-version': '1.2' },
    })
    report.storesStatus = storesRes.status
    report.stores = await safeJson(storesRes)

    const devicesRes = await fetch(`${POYNT_API}/businesses/${BUSINESS_ID}/storeDevices`, {
      headers: { 'Authorization': `BEARER ${merchantToken}`, 'api-version': '1.2' },
    })
    report.devicesStatus = devicesRes.status
    report.devices = await safeJson(devicesRes)

    // 5. Get a fresh jwt-bearer app token now that the merchant grant exists
    const jbRes = await fetch(`${POYNT_API}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'api-version': '1.2' },
      body: `grantType=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(appJWT)}&businessId=${encodeURIComponent(BUSINESS_ID)}`,
    })
    const jbData = await safeJson(jbRes) as Record<string, string>
    report.jwtBearerStatus = jbRes.status
    const jwtBearerToken = jbData?.accessToken ?? null
    report.jwtBearerClaims = jwtBearerToken ? decodeJwtPayload(jwtBearerToken) : jbData

    // 6. Try cloudMessages variants
    const paymentData = JSON.stringify({
      action: 'sale',
      purchaseAmount: 100,
      tipAmount: 0,
      currency: 'USD',
      referenceId: 'diag-prod-test-2',
      callbackUrl: `${SUPABASE_URL}/functions/v1/charge-webhook`,
    })
    const fullBody = { ttl: 90, businessId: BUSINESS_ID, storeId: STORE_ID, deviceId: DEVICE_ID, data: paymentData }
    const variants: { label: string; token: string | null; body: Record<string, unknown>; headers: Record<string, string> }[] = [
      {
        label: 'merchant token + Poynt-Request-Id',
        token: merchantToken,
        body: fullBody,
        headers: { 'api-version': '1.2', 'Poynt-Request-Id': crypto.randomUUID() },
      },
      {
        label: 'app token + Poynt-Request-Id',
        token: jwtBearerToken,
        body: fullBody,
        headers: { 'api-version': '1.2', 'Poynt-Request-Id': crypto.randomUUID() },
      },
      {
        label: 'merchant token, no api-version, proper Bearer case',
        token: merchantToken,
        body: fullBody,
        headers: { 'Poynt-Request-Id': crypto.randomUUID() },
      },
      {
        label: 'merchant token, businessId only (broadcast)',
        token: merchantToken,
        body: { ttl: 90, businessId: BUSINESS_ID, data: paymentData },
        headers: { 'api-version': '1.2', 'Poynt-Request-Id': crypto.randomUUID() },
      },
    ]
    const cmAttempts: Record<string, unknown>[] = []
    for (const v of variants) {
      if (!v.token) { cmAttempts.push({ label: v.label, skipped: 'no token' }); continue }
      const res = await fetch(`${POYNT_API}/cloudMessages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${v.token}`,
          'Content-Type': 'application/json',
          ...v.headers,
        },
        body: JSON.stringify(v.body),
      })
      const body = await safeJson(res)
      cmAttempts.push({ label: v.label, status: res.status, body })
      if (res.ok) break
    }
    report.cloudMessageAttempts = cmAttempts

    return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    report.error = String(err)
    report.stack = (err as Error)?.stack
    return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }
})
