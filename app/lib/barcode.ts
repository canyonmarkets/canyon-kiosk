// Barcode matching for hand scanners.
//
// The same item can reach the kiosk in more than one shape:
//   - with or without leading zeros (UPC-A 012345678905 vs EAN-13 0012345678905,
//     or a catalog entry typed without its leading zero)
//   - as a short UPC-E code (8 digits, e.g. 12oz soda cans) or as the 12-digit
//     UPC-A it stands for, depending on the scanner's "Convert UPC-E to UPC-A"
//     setting and on how the product was originally entered
//
// barcodeKeys() returns every canonical form of a code, and two codes match
// when they share one. UPC-E is only expanded when its check digit is valid,
// so store codes and EAN-8 labels never get mistaken for UPC-E.

const stripLeadingZeros = (s: string) => s.replace(/^0+/, '') || s

function upcCheckDigit(first11: string): number {
  let odd = 0
  let even = 0
  for (let i = 0; i < 11; i++) {
    const d = first11.charCodeAt(i) - 48
    if (i % 2 === 0) odd += d
    else even += d
  }
  return (10 - ((odd * 3 + even) % 10)) % 10
}

// 8-digit UPC-E (number system 0 or 1, six data digits, check digit) to the
// 12-digit UPC-A it compresses. Returns null when the code isn't valid UPC-E.
function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const ns = code[0]
  const d = code.slice(1, 7)
  const check = code[7]
  const last = d[5]
  let body: string
  if (last <= '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4]
  else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4]
  else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4]
  else body = d[0] + d[1] + d[2] + d[3] + d[4] + '0000' + last
  const first11 = ns + body
  if (String(upcCheckDigit(first11)) !== check) return null
  return first11 + check
}

export function barcodeKeys(raw: string | null | undefined): string[] {
  const code = (raw ?? '').trim()
  if (!code) return []
  const keys = new Set<string>([stripLeadingZeros(code)])
  if (/^\d+$/.test(code)) {
    // A 7-digit code is usually a UPC-E whose leading 0 got dropped.
    const asE = code.length === 7 ? '0' + code : code
    const expanded = upcEToUpcA(asE)
    if (expanded) keys.add(stripLeadingZeros(expanded))
  }
  return [...keys]
}

export function barcodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = barcodeKeys(a)
  if (!ka.length) return false
  const kb = barcodeKeys(b)
  return ka.some((k) => kb.includes(k))
}
