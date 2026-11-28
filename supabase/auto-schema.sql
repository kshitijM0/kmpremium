-- PHASE 1 — Auto Order Provider Management
-- Run in Supabase: Project → SQL Editor → New query → paste → Run
-- (Additive only — does not touch or remove anything existing.)

create table if not exists api_providers (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  api_url text not null,
  encrypted_api_key text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_tested timestamptz,
  last_test_status text,        -- 'online' | 'offline' | 'invalid_key' | 'rate_limited' | 'unknown'
  last_test_balance text,
  last_test_currency text,
  last_test_response_ms integer
);

create table if not exists provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references api_providers(id) on delete cascade,
  service_id text not null,
  service_name text,
  category text,
  rate numeric,
  minimum integer,
  maximum integer,
  refill boolean default false,
  cancel boolean default false,
  average_time text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (provider_id, service_id)
);

create table if not exists service_mapping (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (service_type in ('views','likes','shares','saves','reposts','comments')),
  provider_id uuid not null references api_providers(id) on delete cascade,
  provider_service_id text not null,
  customer_rate numeric,           -- what the customer pays per 1000 (markup over provider's own rate)
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_services_provider on provider_services(provider_id);
create index if not exists idx_provider_services_category on provider_services(category);
create index if not exists idx_service_mapping_type on service_mapping(service_type, display_order);

alter table api_providers enable row level security;
alter table provider_services enable row level security;
alter table service_mapping enable row level security;
-- No policies created on purpose — RLS + zero policies = all client (anon key) access
-- denied by default. Only the server, using the service_role key, can read/write.
