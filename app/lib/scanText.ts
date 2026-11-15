// Scans that are not a product barcode, and barcodes that arrive in pieces
// (Nov 11 2026, tightened Nov 14 2026).
//
// 1. QR codes on the package. Coke, Red Bull, Pepsi, Fairlife, ConAgra and others
//    now print a promo QR code next to the UPC. The scanner reads whichever one
//    it sees first, so the same Coke Zero "doesn't scan" for one shopper and
//    scans fine for the next. Those codes are web links and can never match a
//    product, so the kiosk tells the shopper to turn the item to the striped
//    barcode instead of showing the "Not Scanning?" popup, and doesn't log a miss.
//
// 2. Split reads. The scanner types the barcode like a keyboard. If the tablet
//    or the scanner stalls mid-scan, the old 80 ms "no Enter" fallback fired and
//    one barcode arrived as two pieces ("0711" + "59001750" for Corn Nuts
//    071159001750; QR links cut as "https://cokeurl.com/q/20" + "25-01192").
//    Steel Fab's stalls run longer than a second. So:
//      - the keystroke fallback only fires early when what has arrived is
//        already a whole code (isCompleteBarcode or a product match);
//        anything else waits STALL_WAIT_MS of silence for the rest
//      - a piece that still arrives on its own is joined with the one before
//        it if they make a product, for up to SPLIT_JOIN_MS
//      - a piece that is not a whole barcode waits PARTIAL_MISS_MS before it
//        counts as a miss, in case the rest is still coming
//      - pieces arriving within QR_TAIL_MS after a QR code are its tail and
//        are ignored

export const STALL_WAIT_MS = 1200
export const SPLIT_JOIN_MS = 2500
export const PARTIAL_MISS_MS = 1500
export const QR_TAIL_MS = 2500

export const isDigits = (s: string) => /^\d+$/.test(s)

// GS1 mod-10 check digit over every digit but the last (EAN-8, UPC-A, EAN-13, GTIN-14).
function gs1CheckOk(code: string): boolean {
  const body = code.slice(0, -1)
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const d = body.charCodeAt(body.length - 1 - i) - 48
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10 === code.charCodeAt(code.length - 1) - 48
}

// 8-digit UPC-E: valid when its expanded UPC-A has a valid check digit.
function upcEOk(code: string): boolean {
  if (!/^[01]\d{7}$/.test(code)) return false
  const ns = code[0], d = code.slice(1, 7), last = d[5]
  let body: string
  if (last <= '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4]
  else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4]
  else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4]
  else body = d[0] + d[1] + d[2] + d[3] + d[4] + '0000' + last
  return gs1CheckOk(ns + body + code[7])
}

// A whole retail barcode as a scanner sends it: 8, 12, 13 or 14 digits with a
// valid check digit. Anything else is a piece of one (or not a barcode).
export function isCompleteBarcode(raw: string): boolean {
  const s = raw.trim()
  if (!isDigits(s)) return false
  if (s.length === 8) return gs1CheckOk(s) || upcEOk(s)
  if (s.length === 12 || s.length === 13 || s.length === 14) return gs1CheckOk(s)
  return false
}

// A web link or other text a QR code carries. Product barcodes are digits.
// Only consulted after the code failed to match a product, so a store code
// with letters in it still rings up. A short plain code like "ABC123" is NOT
// treated as a QR (it could be a mistyped catalog entry worth an email).
export function looksLikeQrText(raw: string): boolean {
  const s = raw.trim().toLowerCase()
  if (!s) return false
  if (s.includes('://') || s.startsWith('www.') || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//.test(s)) return true
  return /[^a-z0-9-]/.test(s) || s.length > 24
}

export const QR_HINT = 'That\'s the QR code. Turn it so the scanner sees the striped barcode.'
