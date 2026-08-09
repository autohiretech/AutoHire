-- AutoHire migration 045 — accept the external payment system as a rail.
--
-- Payments move to an external hold system that settles through Stripe on its
-- side. AutoHire asks it for a hold at booking and captures at pickup, so the
-- booking lifecycle is unchanged — only the value in `provider` is new.
--
-- 'stripe' and 'flutterwave' stay valid: existing rows keep their provider, and
-- refunds/captures on old bookings still route to the rail that took the money.
--
-- Apply after migration 044. Safe to re-run.

alter table bookings drop constraint if exists bookings_provider_check;
alter table bookings add constraint bookings_provider_check
  check (provider in ('stripe', 'flutterwave', 'external'));

alter table payouts drop constraint if exists payouts_provider_check;
alter table payouts add constraint payouts_provider_check
  check (provider in ('stripe', 'flutterwave', 'external'));

alter table profiles drop constraint if exists profiles_payout_provider_check;
alter table profiles add constraint profiles_payout_provider_check
  check (payout_provider is null or payout_provider in ('stripe', 'flutterwave', 'external'));
