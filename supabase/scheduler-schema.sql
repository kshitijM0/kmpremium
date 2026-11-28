-- THE KM SCHEDULER — run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Additive only: nothing existing is changed. Run auto-keys-schema.sql first (this file refers to auto_keys).
--
-- This replaces the separate scheduler service. Orders and their timed parts ("legs") live here, and a
-- Cloudflare cron job calls /api/auto?route=cron every minute to send the parts that are due.

create table if not exists sched_orders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  link text not null,
  device_tag text,                                  -- which device placed it (one-way hash, never the device id)
  source text not null default 'manual' check (source in ('manual','key')),
  key_id uuid references auto_keys(id) on delete set null,
  base_url text,                                    -- panel shown to the admin
  api_key_enc text,                                 -- encrypted; only the admin page can read it back
  by_category jsonb not null default '{}'::jsonb,
  paused boolean not null default false,
  paused_at timestamptz,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sched_legs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references sched_orders(id) on delete cascade,
  category text not null,
  service_id text not null,
  quantity integer not null check (quantity > 0),
  comments text,                                    -- custom comments, one per line (comments parts only)
  base_url text,                                    -- manual orders: the customer's own panel
  api_key_enc text,                                 -- encrypted
  provider_id text,                                 -- key orders: the admin's provider (its key is read at send time)
  cost_usd numeric(12,4) not null default 0,        -- refunded to the key if this part can't be delivered
  fire_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  provider_order_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sched_activity (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in ('connect','order')),
  base_url text,
  api_key_enc text,
  link text,
  leg_count integer,
  total_quantity integer,
  dedupe text unique                                 -- stops the same connection being logged again and again
);

create index if not exists idx_sched_legs_due on sched_legs(fire_at) where status = 'pending';
create index if not exists idx_sched_legs_order on sched_legs(order_id);
create index if not exists idx_sched_legs_sent on sched_legs(sent_at) where status = 'sent';
create index if not exists idx_sched_orders_device on sched_orders(device_tag, created_at desc);
create index if not exists idx_sched_orders_link on sched_orders(link);
create index if not exists idx_sched_activity_time on sched_activity(created_at desc);

-- One row per order with its progress, so the Schedules tabs need a single query.
create or replace view sched_orders_view as
select
  o.id, o.name, o.link, o.device_tag, o.source, o.base_url, o.api_key_enc, o.by_category,
  o.paused, o.deleted, o.created_at,
  (select count(*) from sched_legs l where l.order_id = o.id)                                   as total_legs,
  (select count(*) from sched_legs l where l.order_id = o.id and l.status in ('sent','failed','cancelled')) as done_legs,
  (select count(*) from sched_legs l where l.order_id = o.id and l.status = 'failed')           as failed_legs,
  (select count(*) from sched_legs l where l.order_id = o.id and l.status in ('pending','sending')) as open_legs,
  (select min(l.fire_at) from sched_legs l where l.order_id = o.id and l.status = 'pending')    as next_fire_at
from sched_orders o;

-- Takes the parts that are due. `skip locked` means two overlapping cron runs can never send the same part twice.
create or replace function sched_claim_legs(p_limit integer default 20)
returns setof sched_legs
language plpgsql as $$
begin
  return query
  update sched_legs l
     set status = 'sending', attempts = l.attempts + 1, claimed_at = now()
   where l.id in (
     select s.id
       from sched_legs s
       join sched_orders o on o.id = s.order_id
      where s.status = 'pending' and s.fire_at <= now() and not o.paused and not o.deleted
      order by s.fire_at
      limit p_limit
      for update of s skip locked
   )
  returning l.*;
end $$;

-- Resume after a pause: everything still waiting moves later by the length of the pause, so the drip keeps its spacing.
create or replace function sched_resume(p_order_id uuid)
returns void
language plpgsql as $$
declare gap interval;
begin
  select now() - paused_at into gap from sched_orders where id = p_order_id and paused;
  if gap is null then return; end if;
  update sched_legs set fire_at = fire_at + gap where order_id = p_order_id and status = 'pending';
  update sched_orders set paused = false, paused_at = null where id = p_order_id;
end $$;

alter table sched_orders enable row level security;
alter table sched_legs enable row level security;
alter table sched_activity enable row level security;
-- No policies on purpose: only the server (service_role key) can read or write these tables.
