-- AutoHire migration 017 — overdue-return notifications.
--
-- Notifies the host AND renter when a trip's end date has passed but the car
-- hasn't been returned/completed. Fires once per booking (tracked by
-- overdue_notified_at).
--
-- Two ways it runs:
--   • pg_cron (if enabled) — hourly, across all bookings.
--   • on demand — the dashboard calls notify_overdue_returns() on load; scoped
--     to the caller's own bookings so it works even without pg_cron.
--
-- Depends on create_notification() from migration 016.
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table bookings
  add column if not exists overdue_notified_at timestamptz;

create or replace function notify_overdue_returns() returns void
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  r record;
begin
  for r in
    select * from bookings b
    where b.state in ('confirmed', 'pickup', 'active', 'return')
      and b.end_date < current_date
      and b.overdue_notified_at is null
      -- cron (uid null) scans everyone; a signed-in caller only their own trips.
      and (uid is null or b.host_id = uid or b.renter_id = uid)
  loop
    perform create_notification(r.host_id, 'return_reminder', 'Car overdue',
      'A trip on your car was due back on ' || r.end_date || ' but is not completed yet.');
    perform create_notification(r.renter_id, 'return_reminder', 'Return overdue',
      'Your rental was due back on ' || r.end_date || '. Please return the car and confirm.');
    update bookings set overdue_notified_at = now() where id = r.id;
  end loop;
end $$;

grant execute on function notify_overdue_returns() to authenticated;

-- Hourly sweep when pg_cron is available (enable it under Database > Extensions).
-- cron.schedule upserts by job name, so re-running is safe.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('autohire-overdue-returns', '0 * * * *',
      $cron$ select notify_overdue_returns() $cron$);
  else
    raise notice 'pg_cron not enabled — overdue notifications still fire on dashboard load. Enable pg_cron under Database > Extensions, then schedule notify_overdue_returns() to run hourly.';
  end if;
end
$do$;
