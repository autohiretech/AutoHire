-- AutoHire migration 046 — account country + renter payment method.
--
-- Two things the app has never recorded about a person:
--
--   1. COUNTRY. Only listings had one. Payout routing was reading the header
--      country selector — a browser localStorage display preference — so a
--      Rwandan host who left it on "United States" was offered bank/card
--      instead of MoMo and routed to the wrong provider, and that choice was
--      then frozen into their profile. This makes it an account fact.
--
--   2. A RENTER'S PAYMENT METHOD. Cards were typed into Stripe Elements at
--      every checkout and never kept, so nobody had a "wallet".
--
-- The external payment-hold system will own both once it is connected: the card
-- lives there (we only ever hold a masked label + their reference), and it is
-- the authority on the payer's country. These columns are the local record it
-- binds to, deliberately shaped like the existing payout_* columns so both
-- sides of the money look the same.
--
-- No raw card data is stored here, and no column ever should hold one.
--
-- Apply after migration 045. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. Country — where this account pays from / is paid into (ISO 3166-1 alpha-2)
-- ----------------------------------------------------------------------------
-- Nullable on purpose: null means "never asked", which the UI prompts for.
-- Distinguishing that from a real choice is why there is no default.
alter table profiles add column if not exists country char(2);

-- ----------------------------------------------------------------------------
-- 2. Renter payment method — the mirror of payout_* on the paying side
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists payment_method text
  check (payment_method in ('card', 'momo', 'bank'));
-- Masked only, e.g. "••••4242". A full number must never reach this column.
alter table profiles add column if not exists payment_destination text;
alter table profiles add column if not exists payment_label text;
alter table profiles add column if not exists payment_status text
  not null default 'none'
  check (payment_status in ('none', 'pending', 'active'));
-- The external system's id for this saved method (its vault token). Null until
-- the API is connected — nothing in AutoHire mints one.
alter table profiles add column if not exists payment_ref text;

-- public_profiles is untouched: payment details stay private to the account
-- (and admins), exactly like the payout columns.
