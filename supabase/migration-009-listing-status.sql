-- AutoHire migration 009 — simple listing status (available / maintenance).
--
-- Replaces the abstract "available_from / available_until" window (migration 007)
-- with a host-friendly status:
--   • available   — bookable normally.
--   • maintenance — out of service until `maintenance_until`; a renter can only
--                   book trips that START on/after that date.
-- "Booked" is NOT a stored status — it's derived from live bookings (the overlap
-- check already blocks taken dates). A helper function exposes a listing's booked
-- date ranges so the UI can show them.
--
-- Apply after migrations 001–006 in the Supabase SQL editor. Safe to re-run.

-- 1. Status enum + columns; drop the old window columns from migration 007.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'listing_status') then
    create type listing_status as enum ('available', 'maintenance');
  end if;
end $$;

alter table listings
  add column if not exists status            listing_status not null default 'available',
  add column if not exists maintenance_until date,
  drop column if exists available_from,
  drop column if exists available_until;

-- 2. Availability trigger — maintenance instead of the old window.
create or replace function booking_check_availability() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  blocked     date[];
  l_status    listing_status;
  maint_until date;
begin
  if new.end_date <= new.start_date then
    raise exception 'Return date must be after pick-up date.';
  end if;

  select blocked_dates, status, maintenance_until
    into blocked, l_status, maint_until
    from listings where id = new.listing_id;

  if l_status = 'maintenance' then
    if maint_until is null then
      raise exception 'This car is in maintenance and not bookable right now.';
    elsif new.start_date < maint_until then
      raise exception 'This car is in maintenance until %.', maint_until;
    end if;
  end if;

  if blocked is not null and exists (
    select 1
    from generate_series(new.start_date, new.end_date - 1, interval '1 day') d
    where d::date = any(blocked)
  ) then
    raise exception 'Those dates are not available for this car.';
  end if;

  if exists (
    select 1 from bookings b
    where b.listing_id = new.listing_id
      and b.id <> new.id
      and b.state not in ('cancelled', 'declined', 'completed')
      and b.start_date < new.end_date
      and b.end_date   > new.start_date
  ) then
    raise exception 'This car is already booked for those dates.';
  end if;

  return new;
end $$;

-- 3. Safe booked-ranges lookup for the booking UI (no identities/amounts).
create or replace function listing_booked_ranges(p_listing_id text)
  returns table (start_date date, end_date date)
  language sql security definer set search_path = public stable as $$
  select b.start_date, b.end_date
  from bookings b
  where b.listing_id = p_listing_id
    and b.state not in ('cancelled', 'declined', 'completed')
  order by b.start_date
$$;
grant execute on function listing_booked_ranges(text) to anon, authenticated;
