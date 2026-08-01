-- AutoHire migration 041 — payout beneficiary token.
--
-- For live payouts we never keep the host's raw account/MoMo number. At payout
-- setup the raw destination is sent once to the provider (Flutterwave), which
-- returns a beneficiary reference; we store only that token here and disburse
-- against it. Stripe hosts store their connected-account id in the same column.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table profiles add column if not exists payout_beneficiary text;
