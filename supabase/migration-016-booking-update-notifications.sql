-- AutoHire migration 016 — notifications for booking actions & handoff proof.
--
-- Migration 015 only covered NEW messages and NEW bookings. This adds the rest:
--   • host approves/declines a request           -> notify renter
--   • a trip is cancelled                          -> notify the other party
--   • one side uploads pickup/return proof         -> notify the other side
--   • both sides signed off (trip active/complete) -> notify both
--
-- All server-side (SECURITY DEFINER) so the actor can write the recipient's
-- notification row, which RLS otherwise forbids.
--
-- Apply after migrations 001–015 in the Supabase SQL editor. Safe to re-run.

-- Small helper so the triggers stay readable.
create or replace function create_notification(
  p_profile text,
  p_kind    notification_kind,
  p_title   text,
  p_body    text
) returns void
  language sql security definer set search_path = public as $$
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('ntf-' || gen_random_uuid(), p_profile, p_kind, p_title, p_body, '{in_app}', now(), false);
$$;

create or replace function notify_on_booking_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  actor text := auth.uid()::text;
begin
  -- Handoff proof uploaded by one side, still waiting on the other.
  if new.state = 'pickup' then
    if new.pickup_renter_at is distinct from old.pickup_renter_at and new.pickup_renter_at is not null then
      perform create_notification(new.host_id, 'pickup_reminder',
        'Pickup confirmed by renter', 'The renter uploaded pickup proof — confirm your side to start the trip.');
    end if;
    if new.pickup_host_at is distinct from old.pickup_host_at and new.pickup_host_at is not null then
      perform create_notification(new.renter_id, 'pickup_reminder',
        'Pickup confirmed by host', 'The host uploaded pickup proof — confirm your side to start the trip.');
    end if;
  end if;
  if new.state = 'return' then
    if new.return_renter_at is distinct from old.return_renter_at and new.return_renter_at is not null then
      perform create_notification(new.host_id, 'return_reminder',
        'Return confirmed by renter', 'The renter uploaded return proof — confirm your side to complete the trip.');
    end if;
    if new.return_host_at is distinct from old.return_host_at and new.return_host_at is not null then
      perform create_notification(new.renter_id, 'return_reminder',
        'Return confirmed by host', 'The host uploaded return proof — confirm your side to complete the trip.');
    end if;
  end if;

  -- State transitions.
  if new.state is distinct from old.state then
    if new.state = 'confirmed' then
      perform create_notification(new.renter_id, 'booking_confirmation',
        'Booking confirmed', 'The host confirmed your booking.');
    elsif new.state = 'declined' then
      perform create_notification(new.renter_id, 'booking_confirmation',
        'Booking declined', 'The host declined your booking request.');
    elsif new.state = 'active' then
      perform create_notification(new.renter_id, 'pickup_reminder',
        'Trip started', 'Both sides confirmed pickup — your trip is now active.');
      perform create_notification(new.host_id, 'pickup_reminder',
        'Trip started', 'Both sides confirmed pickup — the trip is now active.');
    elsif new.state = 'completed' then
      perform create_notification(new.renter_id, 'return_reminder',
        'Trip completed', 'Both sides confirmed return — the trip is complete.');
      perform create_notification(new.host_id, 'return_reminder',
        'Trip completed', 'Both sides confirmed return — the trip is complete.');
    elsif new.state = 'cancelled' then
      if actor is null then
        perform create_notification(new.renter_id, 'booking_confirmation', 'Booking cancelled', 'This booking was cancelled.');
        perform create_notification(new.host_id,  'booking_confirmation', 'Booking cancelled', 'This booking was cancelled.');
      else
        perform create_notification(
          case when actor = new.renter_id then new.host_id else new.renter_id end,
          'booking_confirmation', 'Booking cancelled', 'This booking was cancelled.');
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists booking_update_notify on bookings;
create trigger booking_update_notify after update on bookings
  for each row execute function notify_on_booking_update();
