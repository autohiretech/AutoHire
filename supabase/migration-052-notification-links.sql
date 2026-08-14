-- AutoHire migration 052 — link every booking notification to its trip.
--
-- Migration 043 added `notifications.link` for watchlist notifications, but
-- the booking/pickup/return/overdue triggers from migrations 015-017 never
-- set it — every one of those rows is about one specific booking, yet
-- clicking it only got you a generic "Open dashboard" / "View trip" that
-- landed on a list, not the trip itself. This points them at /trips/<id>,
-- which already renders the right view for whichever side (host or renter)
-- opens it.
--
-- create_notification() gains an optional p_link (default null, so any other
-- caller keeps working unchanged); the three trigger functions that create
-- one notification per booking now pass it.
--
-- Apply after migration 043 in the Supabase SQL editor. Safe to re-run.

-- `create or replace` only replaces a matching signature — adding p_link
-- would otherwise leave the old 4-arg version behind as a second overload.
drop function if exists create_notification(text, notification_kind, text, text);

create or replace function create_notification(
  p_profile text,
  p_kind    notification_kind,
  p_title   text,
  p_body    text,
  p_link    text default null
) returns void
  language sql security definer set search_path = public as $$
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
  values ('ntf-' || gen_random_uuid(), p_profile, p_kind, p_title, p_body, '{in_app}', now(), false, p_link);
$$;

create or replace function notify_on_booking() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
  values (
    'ntf-' || gen_random_uuid(),
    new.host_id,
    'booking_confirmation',
    case when new.state = 'requested' then 'New booking request' else 'New booking' end,
    'A renter ' || (case when new.state = 'requested' then 'requested' else 'booked' end)
      || ' your car for ' || new.start_date || ' to ' || new.end_date || '.',
    '{in_app}',
    now(),
    false,
    '/trips/' || new.id
  );
  return new;
end $$;

create or replace function notify_on_booking_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  actor text := auth.uid()::text;
  trip_link text := '/trips/' || new.id;
begin
  -- Handoff proof uploaded by one side, still waiting on the other.
  if new.state = 'pickup' then
    if new.pickup_renter_at is distinct from old.pickup_renter_at and new.pickup_renter_at is not null then
      perform create_notification(new.host_id, 'pickup_reminder',
        'Pickup confirmed by renter', 'The renter uploaded pickup proof — confirm your side to start the trip.', trip_link);
    end if;
    if new.pickup_host_at is distinct from old.pickup_host_at and new.pickup_host_at is not null then
      perform create_notification(new.renter_id, 'pickup_reminder',
        'Pickup confirmed by host', 'The host uploaded pickup proof — confirm your side to start the trip.', trip_link);
    end if;
  end if;
  if new.state = 'return' then
    if new.return_renter_at is distinct from old.return_renter_at and new.return_renter_at is not null then
      perform create_notification(new.host_id, 'return_reminder',
        'Return confirmed by renter', 'The renter uploaded return proof — confirm your side to complete the trip.', trip_link);
    end if;
    if new.return_host_at is distinct from old.return_host_at and new.return_host_at is not null then
      perform create_notification(new.renter_id, 'return_reminder',
        'Return confirmed by host', 'The host uploaded return proof — confirm your side to complete the trip.', trip_link);
    end if;
  end if;

  -- State transitions.
  if new.state is distinct from old.state then
    if new.state = 'confirmed' then
      perform create_notification(new.renter_id, 'booking_confirmation',
        'Booking confirmed', 'The host confirmed your booking.', trip_link);
    elsif new.state = 'declined' then
      perform create_notification(new.renter_id, 'booking_confirmation',
        'Booking declined', 'The host declined your booking request.', trip_link);
    elsif new.state = 'active' then
      perform create_notification(new.renter_id, 'pickup_reminder',
        'Trip started', 'Both sides confirmed pickup — your trip is now active.', trip_link);
      perform create_notification(new.host_id, 'pickup_reminder',
        'Trip started', 'Both sides confirmed pickup — the trip is now active.', trip_link);
    elsif new.state = 'completed' then
      perform create_notification(new.renter_id, 'return_reminder',
        'Trip completed', 'Both sides confirmed return — the trip is complete.', trip_link);
      perform create_notification(new.host_id, 'return_reminder',
        'Trip completed', 'Both sides confirmed return — the trip is complete.', trip_link);
    elsif new.state = 'cancelled' then
      if actor is null then
        perform create_notification(new.renter_id, 'booking_confirmation', 'Booking cancelled', 'This booking was cancelled.', trip_link);
        perform create_notification(new.host_id,  'booking_confirmation', 'Booking cancelled', 'This booking was cancelled.', trip_link);
      else
        perform create_notification(
          case when actor = new.renter_id then new.host_id else new.renter_id end,
          'booking_confirmation', 'Booking cancelled', 'This booking was cancelled.', trip_link);
      end if;
    end if;
  end if;

  return new;
end $$;

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
      'A trip on your car was due back on ' || r.end_date || ' but is not completed yet.', '/trips/' || r.id);
    perform create_notification(r.renter_id, 'return_reminder', 'Return overdue',
      'Your rental was due back on ' || r.end_date || '. Please return the car and confirm.', '/trips/' || r.id);
    update bookings set overdue_notified_at = now() where id = r.id;
  end loop;
end $$;
