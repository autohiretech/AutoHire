-- AutoHire migration 023 — per-country inventory + per-listing currency.
--
-- Turns the single-market (Rwanda-only) catalogue into a multi-country one:
--   • country        — ISO 3166-1 alpha-2 market the car sits in ('RW','KE','AE'…).
--                       The header country selector filters the catalogue on this.
--   • price_currency — ISO 4217 currency the car is priced + charged in. A Kigali
--                       car stays RWF; a Dubai car is AED; a Nairobi car is KES.
--
-- Existing rows are Rwandan, so the defaults ('RW' / 'RWF') backfill them with no
-- data change needed. Prices in other currencies convert for display via fx_rates
-- (migration-022).
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table listings
  add column if not exists country        char(2) not null default 'RW',
  add column if not exists price_currency char(3) not null default 'RWF';

create index if not exists listings_country_idx on listings (country);
