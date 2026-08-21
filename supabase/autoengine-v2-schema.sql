-- AUTO ENGINE v2 — per-service toggle + custom comments
-- Run in Supabase: Project → SQL Editor → New query → paste → Run

alter table orders add column if not exists order_name text;
alter table orders add column if not exists enabled_services jsonb; -- null = all enabled (backward compatible)
alter table orders add column if not exists comment_text text;
