-- AutoHire migration 022 — foreign-exchange rates for multi-currency pricing.
--
-- Cars are priced in their home currency (listings.price_currency); the app
-- converts prices into the shopper's selected currency for display. Those
-- conversions read this table — the browser NEVER calls an FX provider directly
-- (no API keys shipped, no per-user rate limits).
--
-- Rates are quoted against USD: one row per currency, rate = units per 1 USD.
-- A new `as_of` row is written each day, so history is retained; the app reads
-- the newest as_of per currency (see supabaseClient.getFxRates).
--
-- Refreshed once a day by the `refresh-fx-rates` Edge Function
-- (supabase/functions/refresh-fx-rates). See the scheduling note at the bottom.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists fx_rates (
  base       char(3)     not null,               -- always 'USD' for now
  quote      char(3)     not null,               -- e.g. 'RWF', 'CNY', 'AED'
  rate       numeric     not null check (rate > 0),
  as_of      date        not null default (now() at time zone 'utc')::date,
  source     text        not null default 'seed',
  updated_at timestamptz not null default now(),
  primary key (base, quote, as_of)
);

create index if not exists fx_rates_lookup_idx on fx_rates (base, as_of desc);

alter table fx_rates enable row level security;

-- Rates are public reference data — anyone (even signed-out) may read them.
drop policy if exists fx_rates_read on fx_rates;
create policy fx_rates_read on fx_rates for select using (true);

-- No write policy: only the service role (the Edge Function) may upsert rates.
-- RLS with no matching insert/update policy blocks all client writes.

-- Seed today's rates so prices render before the first cron run. Approximate
-- mid-market values (2026); the daily refresh overwrites them with live rates.
insert into fx_rates (base, quote, rate, source) values
  ('USD', 'USD', 1,    'seed'),
  ('USD', 'RWF', 1300, 'seed'),
  ('USD', 'AED', 3.67, 'seed'),
  ('USD', 'CNY', 7.2,  'seed')
on conflict (base, quote, as_of) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- DAILY REFRESH — pick ONE of these; both call the same Edge Function:
--
--  (A) Dashboard cron (easiest): Supabase Dashboard → Edge Functions →
--      refresh-fx-rates → "Cron" → schedule `15 0 * * *` (00:15 UTC daily).
--      No SQL, no keys in the DB.
--
--  (B) pg_cron in the database (uncomment below). Requires the pg_cron + pg_net
--      extensions and your project's anon key. It POSTs to the function daily.
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'refresh-fx-rates-daily',
--   '15 0 * * *',                         -- 00:15 UTC every day
--   $$
--   select net.http_post(
--     url     := 'https://gsnoggfofbmzamxxyazc.supabase.co/functions/v1/refresh-fx-rates',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <YOUR_ANON_KEY>'   -- from Dashboard → API
--     )
--   );
--   $$
-- );
-- ─────────────────────────────────────────────────────────────────────────────
