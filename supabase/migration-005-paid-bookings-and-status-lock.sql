-- AutoHire migration 005 — payment-gated bookings + booking-status lock.
--
-- Closes four holes in the client-driven booking flow:
--   1. Bookings could be created from the browser without paying (RLS allowed a
--      plain insert; payment via Stripe was decoupled from row creation).
--   2. days / subtotal / fee / total were computed in the browser and inserted
--      verbatim — a renter could set their own price.
--   3. No availability check — blocked dates and double-bookings slipped through.
--   4. bookings_update let the renter or host set ANY state and mutate amounts.
--
-- After this migration the ONLY way a booking row appears is via the
-- `confirm-booking` Edge Function (service role), which first verifies the
-- Stripe PaymentIntent succeeded. Triggers below are the real boundary — they
-- fire even for the service role, so amounts, availability and the status
-- state-machine are enforced no matter who writes.
--
-- Apply after migrations 001–004. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. Payment columns on bookings
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_payment_status') then
    create type booking_payment_status as enum ('unpaid', 'paid', 'refunded');
  end if;
end $$;

alter table bookings
  add column if not exists payment_status    booking_payment_status not null default 'unpaid',
  add column if not exists payment_intent_id text;

-- One booking per PaymentIntent (idempotent confirm + no double-spend).
create unique index if not exists bookings_payment_intent_id_key
  on bookings (payment_intent_id)
  where payment_intent_id is not null;

-- ----------------------------------------------------------------------------
-- 2. RLS: bookings can no longer be inserted from the browser.
--    With no INSERT policy, normal users are denied; the service-role
--    Edge Function bypasses RLS and is the single creation path.
-- ----------------------------------------------------------------------------
drop policy if exists bookings_insert on bookings;

-- Keep update scoped to the two participants (the trigger enforces WHAT may
-- change). Admins / service role bypass for refunds + support.
drop policy if exists bookings_update on bookings;
create policy bookings_update on bookings for update
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin())
  with check (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin());

-- ----------------------------------------------------------------------------
-- 3. Availability — reject blocked dates and overlapping live bookings.
--    Fires on insert and on any date change. A trip is "live" unless it was
--    cancelled, declined or completed.
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so the overlap check sees every booking, not just the
-- caller's RLS-visible rows.
create or replace function booking_check_availability() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  blocked date[];
begin
  if new.end_date <= new.start_date then
    raise exception 'Return date must be after pick-up date.';
  end if;

  select blocked_dates into blocked from listings where id = new.listing_id;

  -- Any day in [start, end) that the host has blocked?
  if blocked is not null and exists (
    select 1
    from generate_series(new.start_date, new.end_date - 1, interval '1 day') d
    where d::date = any(blocked)
  ) then
    raise exception 'Those dates are not available for this car.';
  end if;

  -- Overlap with another live booking on the same car?
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

drop trigger if exists booking_availability on bookings;
create trigger booking_availability
  before insert or update of start_date, end_date, listing_id, state on bookings
  for each row execute function booking_check_availability();

-- ----------------------------------------------------------------------------
-- 4. Status lock — immutable money/date fields + a strict state machine.
--    auth.uid() is null for the service role; admins bypass too. Everyone else
--    may only make the transition that belongs to their role.
-- ----------------------------------------------------------------------------
create or replace function booking_enforce_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
begin
  -- Service role (uid null) and admins may correct/refund anything.
  if uid is null or is_admin() then
    return new;
  end if;

  -- Money, dates, identity and payment fields are never editable by a participant.
  if new.listing_id      is distinct from old.listing_id
     or new.renter_id    is distinct from old.renter_id
     or new.host_id      is distinct from old.host_id
     or new.start_date   is distinct from old.start_date
     or new.end_date     is distinct from old.end_date
     or new.days         is distinct from old.days
     or new.subtotal_rwf is distinct from old.subtotal_rwf
     or new.service_fee_rwf is distinct from old.service_fee_rwf
     or new.total_rwf    is distinct from old.total_rwf
     or new.payment_status    is distinct from old.payment_status
     or new.payment_intent_id is distinct from old.payment_intent_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'Booking amounts, dates and payment cannot be changed.';
  end if;

  -- Status: only the allowed transition for the acting party. Anything else
  -- (including changing status after the trip is finalised) is rejected.
  if new.state is distinct from old.state then
    if uid = old.host_id and uid <> old.renter_id then
      -- Host moves the trip forward, or declines/cancels before it starts.
      if not (
           (old.state = 'requested' and new.state in ('confirmed', 'declined'))
        or (old.state = 'confirmed' and new.state in ('pickup', 'cancelled'))
        or (old.state = 'pickup'    and new.state in ('active', 'cancelled'))
        or (old.state = 'active'    and new.state = 'return')
        or (old.state = 'return'    and new.state = 'completed')
      ) then
        raise exception 'That booking status change is not allowed.';
      end if;
    elsif uid = old.renter_id then
      -- The renter may only cancel, and only before the trip is under way.
      if not (old.state in ('requested', 'confirmed') and new.state = 'cancelled') then
        raise exception 'That booking status change is not allowed.';
      end if;
    else
      raise exception 'Only the renter or host may change this booking.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists booking_enforce on bookings;
create trigger booking_enforce
  before update on bookings
  for each row execute function booking_enforce_update();

-- ----------------------------------------------------------------------------
-- 5. A host can't block dates that overlap a live booking ("say it's
--    unavailable" after the car is already booked for those days).
-- ----------------------------------------------------------------------------
create or replace function listing_block_dates_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.blocked_dates is distinct from old.blocked_dates and exists (
    select 1
    from bookings b
    join unnest(new.blocked_dates) as d on true
    where b.listing_id = new.id
      and b.state not in ('cancelled', 'declined', 'completed')
      and d >= b.start_date and d < b.end_date
      and not (d = any(old.blocked_dates))
  ) then
    raise exception 'Cannot block a date that falls inside an existing booking.';
  end if;
  return new;
end $$;

drop trigger if exists listing_block_dates on listings;
create trigger listing_block_dates
  before update of blocked_dates on listings
  for each row execute function listing_block_dates_guard();
