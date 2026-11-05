-- CUSTOM COMMENTS QUEUE — run once in Supabase: SQL Editor -> New query -> paste -> Run
-- Additive only. Custom comments are sent by The KM server itself (not by the external scheduler), because the
-- scheduler has no field for the comment text. Each part waits here until its time, then the server sends it
-- to the provider with the customer's exact comments.

create table if not exists auto_comment_jobs (
  id uuid primary key default gen_random_uuid(),
  key_id uuid references auto_keys(id) on delete cascade,
  order_id uuid references auto_key_orders(id) on delete cascade,
  provider_id text not null,
  provider_service_id text not null,
  link text not null,
  comments text not null,            -- one comment per line, exactly as the customer typed them
  quantity integer not null,
  cost_usd numeric(12,4) not null default 0,
  fire_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  provider_order_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_auto_comment_jobs_due on auto_comment_jobs(status, fire_at);
create index if not exists idx_auto_comment_jobs_order on auto_comment_jobs(order_id);

-- Takes the jobs that are due. `for update skip locked` means two server instances can never send the same one.
create or replace function auto_comment_claim(p_limit integer default 10)
returns setof auto_comment_jobs
language plpgsql as $$
begin
  return query
  update auto_comment_jobs j
     set status = 'sending', attempts = j.attempts + 1, claimed_at = now()
   where j.id in (
     select id from auto_comment_jobs
      where status = 'pending' and fire_at <= now()
      order by fire_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end $$;

alter table auto_comment_jobs enable row level security;
-- No policies on purpose: only the server (service_role key) can touch this table.
