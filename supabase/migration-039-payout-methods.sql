-- AutoHire migration 039 — host payout methods.
--
-- Hosts (individuals and companies) must add a payout method before they can be
-- paid. Two providers are offered:
--   • Stripe (Connect)  — cards / international payouts (USD, AED, CNY).
--   • Flutterwave       — mobile money + bank payouts across Africa.
--
-- These columns hold the CONNECTED state only. The real provider onboarding
-- (Stripe Connect account link, Flutterwave subaccount) happens server-side and
-- flips `payout_status` to 'active' once the provider confirms; the demo build
-- sets it directly. No secret/token is ever stored here.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- The host picks a METHOD (momo / bank / card); the system routes it to a
-- PROVIDER (flutterwave / stripe). Both are stored.
alter table profiles add column if not exists payout_method text
  check (payout_method in ('momo', 'bank', 'card'));
alter table profiles add column if not exists payout_provider text
  check (payout_provider in ('stripe', 'flutterwave'));
alter table profiles add column if not exists payout_status text
  not null default 'none'
  check (payout_status in ('none', 'pending', 'active'));
-- Masked destination only (e.g. "••••1234") — never a full number.
alter table profiles add column if not exists payout_destination text;
alter table profiles add column if not exists payout_label text;

-- The public_profiles view is unchanged: payout details are private to the host
-- (and admins), never exposed through the public view.
