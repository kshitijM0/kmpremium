-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run

create table if not exists keys (
  id uuid primary key default gen_random_uuid(),
  key_value text not null unique,
  duration_minutes integer not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null default 'admin' check (source in ('admin', 'free_ad')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_reloaded_at timestamptz
);

create index if not exists idx_keys_key_value on keys(key_value);
create index if not exists idx_keys_status on keys(status);

-- Row Level Security: block ALL direct client access.
-- Only the server (using the service_role key) can read/write this table.
alter table keys enable row level security;
-- No policies created on purpose — RLS + zero policies = all client access denied.
