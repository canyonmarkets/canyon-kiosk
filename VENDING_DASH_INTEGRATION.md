# Canyon Kiosk ↔ Vending Dashboard Integration Notes

**Author:** Claude (Opus) · **Date:** 2026-06-13
**Purpose:** Hand-off for whoever continues the kiosk↔dashboard wiring once GoDaddy
provides the final Poynt info. Read this before touching the payment/sync flow.

> 📍 **The master cross-app plan is `../ROADMAP.md`** (root of the combined
> Canyon Kiosk-Dash Project folder) — start there for the full roadmap and phases.
> This file is the kiosk-side deep dive. Note: both repos now live side-by-side
> under that combined folder.

The companion app is **vending-dash** at
`C:\Users\jeffm\Documents\CLAUDE\VENDING\vending-dash` (live: canyonvms.netlify.app,
repo: github.com/canyonmarkets/vending-dash). All the vending-dash changes below
were committed and pushed to `master` on 2026-06-13.

---

## 1. The two apps share ONE Supabase database

This is the most important architectural fact. canyon-kiosk and vending-dash read
and write the **same** Supabase project. Shared tables:

| Table | Written by | Read by | Holds |
|-------|-----------|---------|-------|
| `products` | vending-dash | both | catalog, `sellPrice`, `cost`, `type`, status |
| `machines` | vending-dash | both | machine code↔id, `poyntStoreId`, etc. |
| `app_config` (`machineProductIds`/`machineProductPar`/`machineProductOnHand`) | both | both | per-machine product assignments + par + on-hand |
| `payment_results` | kiosk edge fns | kiosk | one row per charge (status, amount, machine_id) |
| `poynt_tokens` | kiosk oauth-callback | kiosk charge fn | merchant OAuth access/refresh tokens |

The kiosk's product list is **driven by vending-dash**: `app/lib/loadMachineProducts.ts`
resolves the machine CODE (e.g. `SF1`) → DB id, then loads the products assigned to
that machine in vending-dash's *Machine Inventory* checkboxes
(`app_config['machineProductIds']`). So to change what a kiosk shows, edit it in
vending-dash — not here.

---

## 2. What changed in vending-dash on 2026-06-13

### 2a. Inventory now flows end-to-end
Previously sales imports only touched a dead "slot" model; the live par/on-hand
counts never moved. Fixed so the loop is complete:
- **Sale ingested → machine on-hand decremented** (per machine/product).
- **Restock → warehouse decremented** (`restockMachineToPar`, `applyRestockItem`).
- **Received purchase → warehouse incremented**; deleting one backs it out.

The decrement guard (important for the kiosk): a sale only decrements on-hand for a
product that is **assigned to that machine with a par set**. Unassigned / par-0
products are skipped (prevents garbage negatives). So for kiosk machines, every
sellable product must be assigned + given a par in vending-dash Machine Inventory.

### 2b. Nightly Poynt auto-sync (built, dormant until env vars set)
New in vending-dash:
- `app/lib/poyntSync.ts` — server-side: loads machines/products/aliases/dedup-keys
  + on-hand from Supabase, fetches Poynt `/orders`, writes new sale records + dedup
  keys + an import-history row + on-hand decrements. Idempotent via dedup keys.
- `app/api/sync/poynt/auto/route.ts` — secured GET trigger (`CRON_SECRET`).
- `netlify/functions/poynt-nightly.mjs` — runs 11:00 UTC (4 AM Phoenix), pings the route.

**Read §4 before relying on this** — as currently built on the kiosk side, the
Poynt `/orders` pull will NOT carry line items, so it can't deduct inventory per
product. See the gap and the recommended fix.

---

## 3. The identifiers that link the two systems

From `supabase/functions/charge/index.ts` (these are the values the kiosk charges
under; some look like sandbox/initial values and are the likely thing GoDaddy is
finalizing):

- `POYNT_APP_ID`      → `urn:aid:f4f01b8d-…`
- `POYNT_BUSINESS_ID` → `84068c23-6ed2-4114-9a87-07cd3dd58ce7`
- `POYNT_STORE_ID`    → `69d9d6e7-5813-431f-bc4c-058d210faf01`
- `POYNT_DEVICE_ID`   → `6e07c9af-e666-4019-9ebd-16645c4338c0`

**The critical mapping:** whatever `STORE_ID` the kiosk charges under is what shows
up as `order.context.storeId` in Poynt. vending-dash maps that to a machine via the
machine's **`poyntStoreId`** field (Machines → edit). So each kiosk machine's
`poyntStoreId` in vending-dash MUST equal the production STORE_ID it charges under.
And vending-dash's `POYNT_BUSINESS_ID` env var must equal the kiosk's BUSINESS_ID.

---

## 4. ⚠️ CRITICAL GAP — the kiosk does not emit line items

**What happens today (`app/components/screens/PaymentScreen.tsx` + `charge/index.ts`):**
1. Kiosk computes a cart total and calls the `charge` edge function with **only**
   `{ amountCents, referenceId, machineId }`. No products are sent to Poynt.
2. `charge` sends a Poynt **cloudMessages "sale"** with just `purchaseAmount`. Poynt
   processes a payment — it does **not** receive an itemized order.
3. The cart line-items (`items: [...cart]`) are added to the kiosk's **local Zustand
   store only** (`addTransaction`). They are **never written to Supabase**.
4. `payment_results` stores `reference_id, status, transaction_id, amount_cents,
   machine_id` — **no items.**

**Consequence:** vending-dash's Poynt `/orders` pull (§2b) will, at best, see a
payment total with no/empty `items[]`. `parsePoyntOrders` needs `items[]` with
name/quantity/unitPrice to attribute sales to products. So **the Poynt pull alone
cannot deduct inventory or populate per-product sales for kiosk machines.** The
"what was actually bought" data currently dies in the kiosk's browser memory.

### Recommended fix (decision for Jeff + next agent): shared Supabase sales table
Because both apps already share Supabase, the clean bridge is a table the kiosk
writes on every approved sale and vending-dash ingests — no dependence on whether
Poynt order objects carry line items.

Proposed `kiosk_sales` table:
```sql
create table if not exists kiosk_sales (
  id            text primary key,          -- the referenceId (e.g. SF1-1718300000000)
  machine_code  text not null,             -- config.machineId ('SF1')
  items         jsonb not null,            -- [{ productId, name, qty, unitPrice }]
  subtotal      numeric not null,
  tax           numeric not null,
  total         numeric not null,
  completed_at  timestamptz not null,
  ingested      boolean not null default false   -- vending-dash flips this after import
);
```
- **Kiosk side:** in `PaymentScreen.handleApproved()`, after a PROCESSED result,
  insert the cart into `kiosk_sales` (the cart already holds productId/name/price/qty).
- **vending-dash side:** ingest new `kiosk_sales` rows (where `ingested = false`) —
  reuse the same logic as `applyParsedImport`: write `sale_records`, decrement
  `machineProductOnHand`, mark rows ingested. This can replace the Poynt `/orders`
  pull for kiosk machines (keep Poynt only as the payment rail), or run alongside it
  for revenue reconciliation.
- **Revenue must be PRE-TAX.** vending-dash unified every source (Applova/HaHa/
  Cantaloupe/Poynt) to pre-tax revenue on 2026-06-13. The kiosk charges
  tax-inclusive (`total` = subtotal + 9.1%). So when ingesting, record the
  **`subtotal`** as the sale's revenue — NOT `total` — or kiosk machines will read
  ~9% high versus every other machine on the dashboard.

### Alternative: make the kiosk create real Poynt Orders with line items
Keep the Poynt `/orders` pull as-is, but change the charge flow to create a Poynt
**Order** (Orders API) with line items before/with the payment, so
`order.items[]` is populated. More moving parts and depends on Poynt order shape;
the shared-table approach is simpler and more robust given the shared DB.

**Bottom line for the next agent:** the vending-dash Poynt auto-sync is built and
correct *as a Poynt-orders ingestor*, but the kiosk's current charge design means
you should implement the shared `kiosk_sales` path (or add line-item orders) to get
real per-product inventory deduction. Confirm the direction with Jeff first.

---

## 5. Go-live checklist (when GoDaddy confirms the final Poynt info)

Likely what's outstanding from GoDaddy = the **production** business/store/device IDs
and/or completing the merchant OAuth grant that populates `poynt_tokens`.

**Kiosk side (Supabase function secrets):**
- `POYNT_APP_ID`, `POYNT_PRIVATE_KEY`, `POYNT_BUSINESS_ID`, `POYNT_STORE_ID`,
  `POYNT_DEVICE_ID` — set to production values (stop relying on the hardcoded
  fallbacks in `charge/index.ts`).
- Confirm `poynt_tokens` row exists (run the OAuth grant via `oauth-callback`) so
  the charge fn uses the merchant token, not just the app JWT.

**vending-dash side (Netlify env vars):**
- `POYNT_BUSINESS_ID` (= kiosk's), `POYNT_APP_ID`, `POYNT_PRIVATE_KEY`,
  `CRON_SECRET` (any random string; the auto route returns 503 until set),
  optional `SUPABASE_SERVICE_ROLE_KEY`.
- For each kiosk machine: set `poyntStoreId` = production STORE_ID, and assign its
  products with pars in Machine Inventory.

(Full vending-dash detail is also saved in that project's memory under
`poynt_autosync.md`.)

---

## 6. ⚠️ SECURITY — rotate the committed private key

`supabase/functions/charge/index.ts` has a **Poynt RSA private key hardcoded as a
fallback** (the `PRIVATE_KEY_PEM` literal). That secret is committed to git history.
Before/at go-live:
1. Rotate the key in the Poynt developer console (treat the committed one as burned).
2. Store the new key **only** as the `POYNT_PRIVATE_KEY` function secret and delete
   the literal fallback from source.
3. Same for any real `business/store/device` IDs you don't want public.

(The `SUPABASE_ANON_KEY` in `PaymentScreen.tsx` is a publishable anon key — fine to
ship.)

---

## 7. First-live-sale verification (do this before trusting automation)
1. Set the env vars (§5). Ring up one real item on a kiosk; complete the tap.
2. Confirm `payment_results` shows `PROCESSED` and (once §4 is implemented) a
   `kiosk_sales` row with the correct line items.
3. In vending-dash: run the manual **Import → Fetch from Poynt** (or the
   `kiosk_sales` ingest) and confirm the sale appears in Sales, the dashboard
   revenue ticks up, and the product's machine on-hand dropped by the qty sold.
4. Only after that round-trips correctly, let the nightly job run unattended.

---

## 8. File reference map
**canyon-kiosk (this repo):**
- `app/components/screens/PaymentScreen.tsx` — cart total → charge → poll result (no items persisted; fix here)
- `supabase/functions/charge/index.ts` — cloudMessages sale; hardcoded IDs + private key
- `supabase/functions/charge-webhook/index.ts` — Poynt POST-back → updates `payment_results`
- `supabase/functions/charge-status/` — kiosk polls this for PROCESSED/CANCELED
- `supabase/functions/oauth-callback/index.ts` — merchant grant → `poynt_tokens`
- `app/lib/loadMachineProducts.ts` — pulls catalog/assignments from shared Supabase
- `app/lib/config.ts` — machine identity (`?machine=SF2` URL param overrides)

**vending-dash:**
- `app/lib/poyntSync.ts` — server-side Poynt ingest (the auto-sync core)
- `app/api/sync/poynt/auto/route.ts` — secured nightly trigger
- `netlify/functions/poynt-nightly.mjs` — cron
- `app/lib/importParsers.ts` → `parsePoyntOrders` — expects `order.items[]`
- `app/lib/store.ts` → `applyParsedImport` — the decrement logic to mirror for `kiosk_sales`

---

## 9. Kiosk-app bugs fixed in this repo (2026-06-13)

Found while auditing the kiosk for go-live. All build-verified and pushed.

- **Thank-You screen showed `$0.00 charged`.** `PaymentScreen.handleApproved()`
  called `clearCart()` before `page.tsx` read `cartTotal()` for the thank-you total,
  so it always read 0. Fixed: the captured total is now passed through
  `onApproved(total)`.
- **Abandoned cart carried to the next customer.** The idle/timeout timer only
  armed on the `cart` screen — a cart left populated on the `browse`/`products`
  screen sat forever and the next person inherited it. Fixed: the timer now arms on
  any shopping screen; with items it shows the confirm-clear modal, empty it just
  resets to the attract screen. Pointer activity resets it on all shopping screens.
- **Saved transaction subtotal/tax were reverse-derived** from the total
  (`total / (1+taxRate)`), causing rounding drift. Now uses the store's authoritative
  `cartSubtotal()` / `cartTax()` — important for an accurate receipt and for the
  future `kiosk_sales` ingest.

### Known issues left for a decision (NOT changed)
- **Admin price / "Sold Out" edits don't persist.** The Products tab in AdminPanel
  updates local state only; the 5-minute Supabase product refresh silently reverts
  them. Decide where availability lives — vending-dash `products.status`, a
  kiosk-specific table, or auto-hide when on-hand hits 0 — then wire it through.
- **Payment auto-retries on CANCELED.** `PaymentScreen` re-sends a charge 3s after a
  cancel/decline, looping until the shopper taps "Cancel & Return to Cart". Left as-is
  (there is a manual escape and the intent may be deliberate), but worth revisiting —
  returning to the cart on cancel is the more conventional behavior.
- **Demo fallback catalog has duplicate UPCs** (`products.ts`: Coke and Dasani share
  `049000028904`). Only affects the offline demo fallback; the live catalog comes from
  Supabase. Harmless but worth cleaning if the fallback is ever relied on.

### Later 2026-06-13 — Poynt auth sweep-up + admin price/sold-out
- **Poynt auth (`c1e83e3`):** committed the in-progress auth work — `charge` now
  signs the app JWT with the `jose` library and uses the stored merchant token
  (`poynt_tokens`) with refresh; `oauth-callback` completes the grant; `list-devices`
  is a diagnostic. **The hardcoded RSA private key was stripped from all three
  functions** — set `POYNT_PRIVATE_KEY` as a Supabase secret and ROTATE the old key.
- **Admin price/sold-out (`0859cf8`):** price is read-only (managed in the dashboard);
  Sold Out persists per-machine to `app_config['machineHidden']`; `loadMachineProducts`
  hides a product when manually sold-out OR (par set && on-hand ≤ 0). The dashboard
  surfaces/clears the same Sold Out state in Store Inventory (`vending-dash 8e83b0a`).
