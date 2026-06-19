-- AutoHire migration 015 — auto-create notifications for messages & bookings.
--
-- Notifications RLS only lets you insert rows for YOURSELF, so a sender can't
-- write the recipient's notification from the client. These SECURITY DEFINER
-- triggers do it server-side:
--   • new message  -> notify the OTHER participant ('message')
--   • new booking  -> notify the host ('booking_confirmation')
-- Combined with migration 014 (Realtime), the recipient's bell updates live.
--
-- Apply after migrations 001–014 in the Supabase SQL editor. Safe to re-run.

create or replace function notify_on_message() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  c conversations;
  recipient text;
begin
  select * into c from conversations where id = new.conversation_id;
  if c.id is null then return new; end if;
  recipient := case when new.sender_id = c.renter_id then c.host_id else c.renter_id end;
  if recipient is null or recipient = new.sender_id then return new; end if;

  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values (
    'ntf-' || gen_random_uuid(),
    recipient,
    'message',
    'New message',
    left(new.body, 120),
    '{in_app}',
    now(),
    false
  );
  return new;
end $$;

drop trigger if exists message_notify on messages;
create trigger message_notify after insert on messages
  for each row execute function notify_on_message();

create or replace function notify_on_booking() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values (
    'ntf-' || gen_random_uuid(),
    new.host_id,
    'booking_confirmation',
    case when new.state = 'requested' then 'New booking request' else 'New booking' end,
    'A renter ' || (case when new.state = 'requested' then 'requested' else 'booked' end)
      || ' your car for ' || new.start_date || ' to ' || new.end_date || '.',
    '{in_app}',
    now(),
    false
  );
  return new;
end $$;

drop trigger if exists booking_notify on bookings;
create trigger booking_notify after insert on bookings
  for each row execute function notify_on_booking();
