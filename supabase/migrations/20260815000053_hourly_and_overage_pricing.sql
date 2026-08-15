-- AutoHire — migration 053: hourly rentals + late-return overage.
--
-- Two additions:
--
--   1. A host may opt a car into hourly rental (`hourly_booking_enabled`),
--      with its own per-hour rate. An hourly booking is deposited at 50% up
--      front and settled against actual pickup-to-return time once the trip
--      completes — the existing two-sided handoff timestamps
--      (`pickup_renter_at`/`pickup_host_at`/`return_renter_at`/
--      `return_host_at`, stamped by `confirm_handoff()`) ARE the timer; no
--      new timestamp mechanism is needed.
--
--   2. Every booking — daily or hourly — now carries a pickup time, so a late
--      return can be measured against an agreed instant rather than a bare
--      date. Coming back more than 2 hours late is billed at the host's own
--      overage rate (their per-hour rate × a multiplier they set when listing
--      the car).
--
-- Settlement (`actual_hours`, `final_amount_rwf`, `amount_owed_rwf`) is
-- computed by the new `payhold-settle-usage` Edge Function, not in SQL: an
-- hourly overpayment is refunded through PayHold, and every PayHold call goes
-- through `_shared/payhold.ts` from a Function, never from a trigger — see
-- `docs/payhold.md`. `amount_owed_rwf` is display-only everywhere; nothing in
-- this system collects it automatically.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- How a booking is priced
-- ---------------------------------------------------------------------------

do $$ begin
  create type booking_rental_type as enum ('daily', 'hourly');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Listings: hourly opt-in, the host's hourly rate, and their overage rate
-- ---------------------------------------------------------------------------

alter table listings
  add column if not exists hourly_booking_enabled boolean not null default false,
  -- Suggested in the UI as price_per_day_rwf / 24, but stored explicitly and
  -- host-editable — same pattern as price_per_day_rwf itself.
  add column if not exists price_per_hour_rwf integer,
  -- The late-return overage rate is price_per_hour_rwf × overage_multiplier.
  -- "the host will choose the rate if it is price of hour times 2" — set once,
  -- when the car is listed, not per booking.
  add column if not exists overage_multiplier numeric not null default 2;

alter table listings drop constraint if exists listings_price_per_hour_positive;
alter table listings
  add constraint listings_price_per_hour_positive
    check (price_per_hour_rwf is null or price_per_hour_rwf > 0);

alter table listings drop constraint if exists listings_overage_multiplier_positive;
alter table listings
  add constraint listings_overage_multiplier_positive
    check (overage_multiplier > 0);

-- An hourly-enabled car must have set its hourly rate — the UI always sends
-- one alongside the flag, and this is the one guarantee `payhold-create-deal`
-- can lean on without re-deriving a fallback.
alter table listings drop constraint if exists listings_hourly_needs_rate;
alter table listings
  add constraint listings_hourly_needs_rate
    check (not hourly_booking_enabled or price_per_hour_rwf is not null);

-- ---------------------------------------------------------------------------
-- Bookings: the agreed time, the agreed rates, and where settlement lands
-- ---------------------------------------------------------------------------

alter table bookings
  add column if not exists rental_type booking_rental_type not null default 'daily',
  -- The time-of-day half of start_date/end_date. Naive (no timezone), same as
  -- start_date/end_date already are — there is no per-market timezone
  -- handling anywhere else in this schema, and adding one here alone would
  -- not make the comparison against pickup_*_at (a real timestamptz instant)
  -- any more correct.
  add column if not exists pickup_time time,
  -- For a daily booking this is what "the agreed time" means for the 2-hour
  -- grace. For an hourly booking it is pickup_time + estimated_hours,
  -- computed at booking creation and stored rather than re-derived.
  add column if not exists expected_return_time time,
  add column if not exists estimated_hours integer,
  -- Snapshots of the listing's rates at booking time — immutable once set,
  -- same reasoning as subtotal_rwf/service_fee_rwf/total_rwf below.
  add column if not exists price_per_hour_rwf integer,
  add column if not exists overage_rate_rwf integer,
  -- What was actually funded up front: 50% of the estimate for hourly,
  -- total_rwf for daily (unchanged from today's full-upfront payment).
  add column if not exists deposit_amount_rwf integer,
  -- Written once, by payhold-settle-usage, when the trip reaches 'completed'.
  add column if not exists actual_hours integer,
  add column if not exists final_amount_rwf integer,
  -- Positive means more is owed than was collected. Never collected by this
  -- system — shown on the trip and earnings screens, chased by the host.
  add column if not exists amount_owed_rwf integer not null default 0;

alter table bookings drop constraint if exists bookings_estimated_hours_positive;
alter table bookings
  add constraint bookings_estimated_hours_positive
    check (estimated_hours is null or estimated_hours > 0);

alter table bookings drop constraint if exists bookings_hourly_needs_estimate;
alter table bookings
  add constraint bookings_hourly_needs_estimate
    check (rental_type = 'daily' or estimated_hours is not null);

-- ---------------------------------------------------------------------------
-- Lock the new agreed-at-booking fields the same way amounts/dates are
-- locked; let the new settlement fields through only for the service role
-- (payhold-settle-usage writes them with the service key, same as
-- payhold-webhook already writes hold_status/payment_status).
-- ---------------------------------------------------------------------------

create or replace function booking_enforce_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  refund_ok boolean;
begin
  if uid is null or is_admin() then
    return new;
  end if;

  -- A paid booking may be refunded, but only as part of a cancellation/decline.
  refund_ok := old.payment_status = 'paid'
    and new.payment_status = 'refunded'
    and new.state in ('cancelled', 'declined');

  if new.listing_id      is distinct from old.listing_id
     or new.renter_id    is distinct from old.renter_id
     or new.host_id      is distinct from old.host_id
     or new.start_date   is distinct from old.start_date
     or new.end_date     is distinct from old.end_date
     or new.days         is distinct from old.days
     or new.subtotal_rwf is distinct from old.subtotal_rwf
     or new.service_fee_rwf is distinct from old.service_fee_rwf
     or new.total_rwf    is distinct from old.total_rwf
     or (new.payment_status is distinct from old.payment_status and not refund_ok)
     or new.payment_intent_id is distinct from old.payment_intent_id
     or new.created_at   is distinct from old.created_at
     or new.rental_type          is distinct from old.rental_type
     or new.pickup_time          is distinct from old.pickup_time
     or new.expected_return_time is distinct from old.expected_return_time
     or new.estimated_hours      is distinct from old.estimated_hours
     or new.price_per_hour_rwf   is distinct from old.price_per_hour_rwf
     or new.overage_rate_rwf     is distinct from old.overage_rate_rwf
     or new.deposit_amount_rwf   is distinct from old.deposit_amount_rwf
     or new.actual_hours         is distinct from old.actual_hours
     or new.final_amount_rwf     is distinct from old.final_amount_rwf
     or new.amount_owed_rwf      is distinct from old.amount_owed_rwf then
    raise exception 'Booking amounts, dates and payment cannot be changed.';
  end if;

  -- Handoff: each side may only stamp its OWN confirmation slot.
  if uid = old.renter_id and (
       new.pickup_host_at is distinct from old.pickup_host_at
    or new.return_host_at is distinct from old.return_host_at
  ) then
    raise exception 'You can only confirm your own side of the handoff.';
  end if;
  if uid = old.host_id and uid <> old.renter_id and (
       new.pickup_renter_at is distinct from old.pickup_renter_at
    or new.return_renter_at is distinct from old.return_renter_at
  ) then
    raise exception 'You can only confirm your own side of the handoff.';
  end if;

  if new.state is distinct from old.state then
    if not (uid = old.renter_id or uid = old.host_id) then
      raise exception 'Only the renter or host may change this booking.';
    end if;

    if new.state in ('cancelled', 'declined') then
      if uid = old.host_id and uid <> old.renter_id then
        if not (
             (old.state = 'requested' and new.state = 'declined')
          or (old.state in ('confirmed', 'pickup') and new.state = 'cancelled')
        ) then
          raise exception 'That booking status change is not allowed.';
        end if;
      elsif uid = old.renter_id then
        if not (old.state in ('requested', 'confirmed') and new.state = 'cancelled') then
          raise exception 'That booking status change is not allowed.';
        end if;
      end if;
    else
      -- Forward handoff transitions. Reaching 'active'/'completed' needs both
      -- sign-offs; 'pickup'/'return' are the in-progress (one side) states.
      if not (
           (old.state = 'requested' and new.state = 'confirmed' and uid = old.host_id)
        or (old.state in ('confirmed', 'pickup') and new.state = 'pickup')
        or (old.state in ('confirmed', 'pickup') and new.state = 'active'
            and new.pickup_renter_at is not null and new.pickup_host_at is not null)
        or (old.state in ('active', 'return') and new.state = 'return')
        or (old.state in ('active', 'return') and new.state = 'completed'
            and new.return_renter_at is not null and new.return_host_at is not null)
      ) then
        raise exception 'That booking status change is not allowed.';
      end if;
    end if;
  end if;

  return new;
end $$;
