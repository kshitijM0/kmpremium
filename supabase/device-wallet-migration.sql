-- DEVICE-LINKED WALLET MIGRATION
-- Run in Supabase: Project → SQL Editor → New query → paste → Run
-- (Additive/compatible — old keys.wallet_balance is simply no longer used.)

create table if not exists devices (
  device_id text primary key,
  wallet_balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- wallet_transactions now points at a device, not a key. key_id is kept
-- (nullable) purely for audit context — "which key was active at the time".
alter table wallet_transactions add column if not exists device_id text references devices(device_id) on delete cascade;
alter table wallet_transactions alter column key_id drop not null;

-- Atomic, upserting adjustment: creates the device row on first use, then
-- credits/debits it in a single statement (no race condition).
create or replace function adjust_device_wallet_balance(p_device_id text, p_delta numeric)
returns numeric
language sql
as $$
  insert into devices (device_id, wallet_balance, updated_at)
  values (p_device_id, p_delta, now())
  on conflict (device_id)
  do update set wallet_balance = devices.wallet_balance + excluded.wallet_balance, updated_at = now()
  returning wallet_balance;
$$;

alter table devices enable row level security;
-- No policies created on purpose — RLS + zero policies = all client (anon key)
-- access denied by default. Only the server (service_role key) can read/write.
