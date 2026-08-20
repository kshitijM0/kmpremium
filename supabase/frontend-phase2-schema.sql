-- FRONTEND PHASE 2 — My APIs + Manual Order history
-- Run in Supabase: Project → SQL Editor → New query → paste → Run

-- user_api_profiles already exists (from the wallet foundation phase) but
-- was linked to key_id. Migrate it to device_id, matching how wallet/orders
-- already work (identity persists across key renewals on the same device).
alter table user_api_profiles add column if not exists device_id text references devices(device_id) on delete cascade;
alter table user_api_profiles add column if not exists status text not null default 'active' check (status in ('active','disabled'));
alter table user_api_profiles alter column key_id drop not null;

-- Full service catalog for each of the customer's OWN connected panels
-- (mirrors provider_services, but scoped per customer profile — never mixed).
create table if not exists user_provider_services (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references user_api_profiles(id) on delete cascade,
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
  unique (profile_id, service_id)
);

-- Manual orders: customer pays their own provider directly. No wallet hold,
-- no chunking, no scheduler, no engine involvement at all.
create table if not exists manual_orders (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references devices(device_id) on delete cascade,
  profile_id uuid references user_api_profiles(id),
  provider_service_id text,
  service_name text,
  link text not null,
  quantity integer not null,
  provider_order_id text,
  status text not null default 'pending' check (status in ('pending','processing','partial','completed','cancelled','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_provider_services_profile on user_provider_services(profile_id);
create index if not exists idx_manual_orders_device on manual_orders(device_id, created_at desc);

alter table user_provider_services enable row level security;
alter table manual_orders enable row level security;
