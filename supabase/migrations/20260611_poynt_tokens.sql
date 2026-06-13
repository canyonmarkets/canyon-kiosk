create table if not exists poynt_tokens (
  id integer primary key,
  business_id text not null,
  access_token text,
  refresh_token text,
  updated_at timestamptz default now()
);
