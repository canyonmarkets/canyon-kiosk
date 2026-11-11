// Scans that are not a product barcode, and barcodes that arrive in two pieces
// (Nov 11 2026).
//
// 1. QR codes on the package. Coke, Red Bull, Pepsi, Fairlife, ConAgra and others
//    now print a promo QR code next to the UPC. The scanner reads whichever one
//    it sees first, so the same Coke Zero "doesn't scan" for one shopper and
//    scans fine for the next. Those codes are web links and can never match a
//    product, so the kiosk tells the shopper to turn the item to the striped
//    barcode instead of showing the "Not Scanning?" popup, and doesn't log a miss.
//
// 2. Split reads. The scanner types the barcode like a keyboard. If the tablet
//    stalls for a moment mid-scan, the 80 ms "no Enter" fallback fires and one
//    barcode arrives as two pieces (seen: "04749" + "5112900" for 047495112900,
//    "0783150" + "4" for Dr Pepper 07831504). Pieces that arrive within
//    SPLIT_JOIN_MS are joined and tried again before anything counts as a miss.

export const SPLIT_JOIN_MS = 400

export const isDigits = (s: string) => /^\d+$/.test(s)

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
