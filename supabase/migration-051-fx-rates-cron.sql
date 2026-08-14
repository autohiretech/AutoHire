-- AutoHire migration 051 — actually schedule the daily FX refresh.
--
-- migration-022 created `fx_rates` and shipped a one-time seed, with a note
-- to wire up refresh-fx-rates via either the Dashboard's cron UI or pg_cron.
-- Neither had been done — every row was still the 2026-07-08 seed a month
-- later, RWF included, off by ~13% from the live rate. This applies option
-- (B) from that note so the refresh actually runs without a manual dashboard
-- step, and is safe to re-run (`cron.schedule` upserts by job name).
--
-- refresh-fx-rates has `verify_jwt = false` (see supabase/config.toml), so
-- the scheduler can call it with no key at all — nothing secret lives in
-- this migration.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'refresh-fx-rates-daily',
  '15 0 * * *',                         -- 00:15 UTC every day
  $$
  select net.http_post(
    url     := 'https://gsnoggfofbmzamxxyazc.supabase.co/functions/v1/refresh-fx-rates',
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);
