-- AutoHire migration 083 — a payout account nobody got to verifies itself
-- after a wait the admin sets.
--
-- 081 closed the gap where an admin verifies a person and forgets their payout
-- account: verifying the person now verifies the account with them. It only
-- covers accounts that exist at that moment. The one this does not cover is
-- the one that actually stops money: a host who was verified months ago
-- changes their MoMo number. PayHold archives the old destination and the new
-- one arrives unverified, so `route_payout` refuses it — and nothing in
-- AutoHire tells anybody. The host's earnings simply stop, and the first
-- person to find out is the host, complaining.
--
-- `payout_auto_verify_after_hours` is the standing instruction for that case:
-- when a payout account has been on file this long and no admin has verified
-- or rejected it, AutoHire verifies it, so payouts start. Hours, because the
-- admin may want either — 4 hours or 14 days, both are this column.
--
--   0                  off; every account waits for an admin
--   72 (the default)   three days for an admin to object, then it goes through
--
-- Three things keep this from being a hole:
--
--   * only for a host whose own verification says `verified` and who is not
--     suspended — the account is the second check, never the first;
--   * PayHold's §5.1 security hold is untouched and cannot be shortened from
--     here, so a takeover still waits out the hold before any transfer;
--   * it is a real relayed PayHold call, `autohire-auto-verify:<hours>h` as the
--     verifier, so PayHold's audit log and the admin's own card both say the
--     wait decided it and not a person.
--
-- The sweep is the `payhold-auto-verify-payouts` Edge Function, scheduled below
-- the way migration 051 schedules the FX refresh. The clock lives inside the
-- function, so calling it early verifies nothing early.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table app_settings
  add column if not exists payout_auto_verify_after_hours integer not null default 72,
  add column if not exists payout_auto_verify_last_run_at timestamptz,
  add column if not exists payout_auto_verify_last_count integer not null default 0;

-- A year is the ceiling: past that the setting is off in every sense but the
-- name, and a mistyped 720000 should be refused rather than stored.
alter table app_settings drop constraint if exists app_settings_auto_verify_after_range;
alter table app_settings add constraint app_settings_auto_verify_after_range
  check (payout_auto_verify_after_hours between 0 and 8760);

comment on column app_settings.payout_auto_verify_after_hours is
  'Hours a host''s payout account may sit unverified before AutoHire verifies it in PayHold. 0 = never; each account waits for an admin. Default 72 (three days).';
comment on column app_settings.payout_auto_verify_last_run_at is
  'When the payhold-auto-verify-payouts sweep last ran. Written by the sweep, read by it to throttle itself.';
comment on column app_settings.payout_auto_verify_last_count is
  'How many payout accounts that run verified.';

-- ---------------------------------------------------------------------------
-- The admin's knob
-- ---------------------------------------------------------------------------
--
-- Validated here rather than left to the constraint, because "must be between
-- 0 and 8760" reaching the browser as a Postgres constraint name is not an
-- answer anybody can act on.

create or replace function admin_set_payout_auto_verify_after(p_hours integer) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_hours integer := coalesce(p_hours, 0);
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if v_hours < 0 or v_hours > 8760 then
    raise exception 'The wait must be between 0 hours (off) and 8760 hours (a year).';
  end if;
  update app_settings set payout_auto_verify_after_hours = v_hours where id = 1;
  return v_hours;
end $$;

revoke all on function admin_set_payout_auto_verify_after(integer) from anon;
grant execute on function admin_set_payout_auto_verify_after(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Running it
-- ---------------------------------------------------------------------------
--
-- Hourly, on the same pg_cron/pg_net pair migration 051 set up. The function
-- has `verify_jwt = false` (supabase/config.toml) so the scheduler needs no
-- key — and needs none: it takes no input, it answers with counts and no
-- names, and every account it touches has to have been on file for the
-- configured wait, which an extra call cannot bring forward. `cron.schedule`
-- upserts by job name, so re-running this migration re-points the job rather
-- than creating a second one.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'payhold-auto-verify-payouts-hourly',
  '20 * * * *',                         -- :20 past every hour, UTC
  $$
  select net.http_post(
    url     := 'https://gsnoggfofbmzamxxyazc.supabase.co/functions/v1/payhold-auto-verify-payouts',
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);
