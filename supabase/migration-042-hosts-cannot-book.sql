-- AutoHire migration 042 — hosts and companies can view cars but never book one.
--
-- Migration 004 blocked business/company accounts at the RLS insert policy.
-- Since migration 005 there is no client insert policy at all: booking rows are
-- written by the Edge Functions with the service role, which bypasses RLS — so
-- that policy no longer enforces anything. This puts the rule back where it
-- holds for every creation path (confirm-booking, flutterwave-webhook, a manual
-- service-role insert) as a trigger, and widens it from companies to every host
-- account (role 'owner'), company or personal.
--
-- Hosts stay free to browse and view listings; only checkout is refused.
--
-- Apply after migrations 001–041. Safe to re-run.

create or replace function booking_renter_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  r_role       user_role;
  r_owner_type owner_type;
begin
  select role, owner_type into r_role, r_owner_type
    from profiles where id = new.renter_id;

  if r_owner_type = 'business' then
    raise exception 'Company accounts cannot rent — they can only view cars.';
  end if;
  if r_role = 'owner' then
    raise exception 'Host accounts cannot rent — they can only view cars.';
  end if;

  -- A host can't rent their own car either (belt and braces — the Edge
  -- Functions refuse this too).
  if new.renter_id = new.host_id then
    raise exception 'You cannot book your own car.';
  end if;

  return new;
end $$;

drop trigger if exists booking_renter on bookings;
create trigger booking_renter
  before insert on bookings
  for each row execute function booking_renter_guard();

-- Migration 004's policy is dead weight now (no client inserts reach it), but
-- leave nothing behind that suggests the browser may insert a booking.
drop policy if exists bookings_insert on bookings;
