-- MANUAL UPI DEPOSIT MODULE
-- Run in Supabase: Project → SQL Editor → New query → paste → Run

alter table wallet_transactions add column if not exists screenshot_url text;
alter table wallet_transactions add column if not exists rejection_reason text;
alter table wallet_transactions add column if not exists processed_by text; -- which admin session handled it (audit only)

-- Replace the old unique index: a REJECTED UTR can be resubmitted, but a
-- PENDING or COMPLETED UTR can never be duplicated.
drop index if exists idx_wallet_tx_gateway_ref;
create unique index if not exists idx_wallet_tx_gateway_ref_active
  on wallet_transactions(gateway, gateway_reference)
  where gateway_reference is not null and status != 'failed';
