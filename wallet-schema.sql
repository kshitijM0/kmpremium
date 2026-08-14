-- WALLET FOUNDATION
-- Run in Supabase: Project → SQL Editor → New query → paste → Run
-- (Additive only — does not remove or rename anything existing.)

alter table keys add column if not exists wallet_balance numeric not null default 0;

create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references keys(id) on delete cascade,
  type text not null check (type in ('deposit','auto_order_charge','refund','admin_adjustment')),
  amount numeric not null,          -- positive = credit, negative = debit
  balance_after numeric not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists user_api_profiles (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references keys(id) on delete cascade,
  profile_name text not null,
  api_url text not null,
  encrypted_api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wallet_tx_key on wallet_transactions(key_id, created_at desc);
create index if not exists idx_user_api_profiles_key on user_api_profiles(key_id);

-- Atomic balance adjustment (single UPDATE statement — no read-then-write
-- race condition even under concurrent requests). Negative delta = debit.
create or replace function adjust_wallet_balance(p_key_id uuid, p_delta numeric)
returns numeric
language sql
as $$
  update keys
  set wallet_balance = wallet_balance + p_delta
  where id = p_key_id
  returning wallet_balance;
$$;

alter table wallet_transactions enable row level security;
alter table user_api_profiles enable row level security;
-- No policies created on purpose — RLS + zero policies = all client (anon key)
-- access denied by default. Only the server (service_role key) can read/write.
