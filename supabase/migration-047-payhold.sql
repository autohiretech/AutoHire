-- AutoHire — migration 047: PayHold integration.
--
-- PayHold is the escrow + payout platform AutoHire is tenant #1 on. It owns the
-- money: the hold, the clearance clock, the seller's wallet and the payout. What
-- AutoHire keeps is the join — which PayHold deal is this booking, which PayHold
-- seller is this host, which PayHold case is this dispute.
--
-- No balance columns. The ledger lives in PayHold and is read from
-- GET /v1/sellers/:id/balance; a mirrored copy here would drift the first time a
-- webhook was missed, and a wrong balance is worse than a slow one.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Bookings: which deal paid for this trip
-- ---------------------------------------------------------------------------

alter table bookings add column if not exists payhold_deal_id text;

-- One booking per deal. This is what makes the webhook idempotent: PayHold
-- retries five times (1m, 5m, 30m, 2h), and a redelivery of order.funded_held
-- must find the booking it already made rather than make a second one.
create unique index if not exists bookings_payhold_deal_id_key
  on bookings (payhold_deal_id)
  where payhold_deal_id is not null;

-- ---------------------------------------------------------------------------
-- Profiles: which seller gets paid
-- ---------------------------------------------------------------------------
--
-- Set when a host registers a payout destination. PayHold tokenizes the raw
-- number on its side and hands back a seller id; AutoHire stores the id and
-- never sees the token.

alter table profiles add column if not exists payhold_seller_id text;

create unique index if not exists profiles_payhold_seller_id_key
  on profiles (payhold_seller_id)
  where payhold_seller_id is not null;

-- ---------------------------------------------------------------------------
-- Disputes: which case is being adjudicated
-- ---------------------------------------------------------------------------

alter table disputes add column if not exists payhold_dispute_id text;

-- ---------------------------------------------------------------------------
-- 'payhold' as a provider
-- ---------------------------------------------------------------------------
--
-- Same widening migration 045 did for 'external'. The column is text with a
-- check rather than an enum precisely so this is an ALTER and not a type
-- rewrite.

do $$
begin
  alter table bookings drop constraint if exists bookings_provider_check;
  alter table bookings add constraint bookings_provider_check
    check (provider is null or provider in ('stripe', 'flutterwave', 'demo', 'external', 'payhold'));

  alter table payouts drop constraint if exists payouts_provider_check;
  alter table payouts add constraint payouts_provider_check
    check (provider is null or provider in ('stripe', 'flutterwave', 'demo', 'external', 'payhold'));

  alter table profiles drop constraint if exists profiles_payout_provider_check;
  alter table profiles add constraint profiles_payout_provider_check
    check (payout_provider is null or payout_provider in ('stripe', 'flutterwave', 'external', 'payhold'));
end $$;

comment on column bookings.payhold_deal_id is
  'PayHold deal this booking was paid through. Unique — the webhook is idempotent on it.';
comment on column profiles.payhold_seller_id is
  'PayHold seller record for this host. Set once a payout destination is registered.';
comment on column disputes.payhold_dispute_id is
  'PayHold Resolution Center case mirroring this dispute.';
