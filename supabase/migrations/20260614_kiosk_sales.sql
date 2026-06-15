-- kiosk_sales — the sales→inventory bridge between canyon-kiosk and vending-dash.
--
-- Written by the `charge` edge function at charge time (status PENDING) so the cart
-- contents survive even if the kiosk client times out or navigates away, then flipped
-- to PROCESSED/CANCELED by `charge-webhook` (keyed by the same reference_id it uses for
-- payment_results). vending-dash ingests rows where status='PROCESSED' AND ingested=false:
-- it writes sale_records (revenue = pre-tax `subtotal`, NOT `total`) and decrements
-- machineProductOnHand, then sets ingested=true. Idempotent via sale_records.dedupKey.
--
-- Additive only — does not touch any existing table.

create table if not exists kiosk_sales (
  id            text primary key,                 -- referenceId, e.g. 'SF1-1718300000000'
  machine_code  text not null,                    -- kiosk config.machineId ('SF1')
  items         jsonb not null,                   -- [{ productId, name, qty, unitPrice }] (unitPrice = pre-tax)
  subtotal      numeric not null,                 -- PRE-TAX total — this is the revenue figure
  tax           numeric not null,
  total         numeric not null,                 -- amount charged on the card (subtotal + tax)
  status        text not null default 'PENDING',  -- PENDING | PROCESSED | CANCELED
  completed_at  timestamptz,                      -- set when the webhook marks it PROCESSED
  ingested      boolean not null default false,   -- vending-dash flips this after import
  created_at    timestamptz not null default now()
);

-- The dashboard ingest query filters on (status, ingested); index it.
create index if not exists idx_kiosk_sales_pending_ingest on kiosk_sales (status, ingested);

-- NOTE on RLS: this project's existing tables (payment_results, poynt_tokens,
-- sale_records, app_config) operate without restrictive RLS — the edge functions
-- use the service-role key and the dashboard uses the anon key. kiosk_sales follows
-- the same model. If you later enable RLS project-wide, add policies that let the
-- service role write and the dashboard read/update this table.
