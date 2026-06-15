create table if not exists payment_results (
  reference_id   text primary key,
  status         text not null default 'PENDING',
  transaction_id text,
  amount_cents   integer,
  machine_id     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_payment_results_created on payment_results (created_at);
