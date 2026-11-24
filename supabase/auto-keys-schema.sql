-- AUTO KEYS (prepaid USD balance) — run once in Supabase: SQL Editor -> New query -> paste -> Run
-- Additive only. Does not touch any existing table.

create table if not exists auto_keys (
  id uuid primary key default gen_random_uuid(),
  key_value text not null unique,
  initial_usd numeric(12,4) not null check (initial_usd > 0),
  remaining_usd numeric(12,4) not null check (remaining_usd >= 0),
  status text not null default 'active' check (status in ('active','exhausted','revoked')),
  note text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  exhausted_at timestamptz
);

create table if not exists auto_key_orders (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references auto_keys(id) on delete cascade,
  client_token text,
  order_name text,
  link text,
  window_choice text,
  cost_usd numeric(12,4),
  legs_count integer,
  quantities jsonb,
  status text not null default 'pending' check (status in ('pending','scheduled','rejected','failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (key_id, client_token)
);

create table if not exists auto_key_events (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references auto_keys(id) on delete cascade,
  type text not null check (type in ('create','topup','order','refund','revoke')),
  amount numeric(12,4),
  balance_after numeric(12,4),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auto_keys_status on auto_keys(status);
create index if not exists idx_auto_key_orders_key on auto_key_orders(key_id, created_at desc);
create index if not exists idx_auto_key_events_key on auto_key_events(key_id, created_at desc);

-- Atomic spend: ONE update statement, so two orders at the same moment can never overspend.
-- When the balance drops below $0.01 the key switches to 'exhausted' by itself.
create or replace function auto_key_spend(p_key_id uuid, p_amount numeric)
returns table(ok boolean, remaining numeric, new_status text)
language plpgsql as $$
declare r numeric; s text;
begin
  update auto_keys set
    remaining_usd = remaining_usd - p_amount,
    last_used_at = now(),
    status = case when remaining_usd - p_amount < 0.01 then 'exhausted' else status end,
    exhausted_at = case when remaining_usd - p_amount < 0.01 then now() else exhausted_at end
  where id = p_key_id and status = 'active' and remaining_usd >= p_amount
  returning remaining_usd, status into r, s;
  if not found then
    return query select false, null::numeric, null::text;
    return;
  end if;
  return query select true, r, s;
end $$;

-- Credit (refund of a failed order, or an admin top-up). Re-activates an exhausted key.
create or replace function auto_key_credit(p_key_id uuid, p_amount numeric, p_is_topup boolean default false)
returns table(ok boolean, remaining numeric, new_status text)
language plpgsql as $$
declare r numeric; s text;
begin
  update auto_keys set
    remaining_usd = remaining_usd + p_amount,
    initial_usd = case when p_is_topup then initial_usd + p_amount else initial_usd end,
    status = case when remaining_usd + p_amount >= 0.01 then 'active' else status end,
    exhausted_at = case when remaining_usd + p_amount >= 0.01 then null else exhausted_at end
  where id = p_key_id and status in ('active','exhausted')
  returning remaining_usd, status into r, s;
  if not found then
    return query select false, null::numeric, null::text;
    return;
  end if;
  return query select true, r, s;
end $$;

alter table auto_keys enable row level security;
alter table auto_key_orders enable row level security;
alter table auto_key_events enable row level security;
-- No policies on purpose: only the server (service_role key) can touch these.
