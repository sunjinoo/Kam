-- KAM production schema for Supabase/PostgreSQL.
-- Keep RLS enabled and do not expose the service-role key to browsers.
create extension if not exists pgcrypto;

create table if not exists public.kam_contributions (
  id text primary key,
  user_key text not null,
  kind text not null check (kind in ('product','service')),
  category text not null,
  item_name text not null,
  brand text,
  model text,
  variant text,
  governorate text not null,
  city text,
  price numeric(14,2) not null check (price > 0),
  currency text not null default 'EGP',
  date_paid date not null,
  seller_name text,
  source_type text not null default 'personal_experience',
  source_url text,
  note text,
  rating smallint check (rating between 1 and 5),
  proof_status text not null default 'not_provided',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderation_note text,
  created_at timestamptz not null default now(),
  moderated_at timestamptz
);

create index if not exists kam_contributions_public_idx
  on public.kam_contributions (status, kind, category, governorate, date_paid desc);
create index if not exists kam_contributions_user_idx
  on public.kam_contributions (user_key, created_at desc);

alter table public.kam_contributions enable row level security;
-- Browser access is intentionally disabled. All reads/writes go through server.mjs
-- using SUPABASE_SERVICE_ROLE_KEY held only in the server environment.

create table if not exists public.kam_price_snapshots (
  id bigserial primary key,
  provider text not null,
  product_id text not null,
  retailer text not null,
  price numeric(14,2) not null check (price > 0),
  currency text not null default 'EGP',
  availability boolean,
  observed_at timestamptz not null,
  source_url text,
  raw_hash text
);
create index if not exists kam_price_snapshots_product_idx
  on public.kam_price_snapshots (product_id, observed_at desc);
alter table public.kam_price_snapshots enable row level security;
