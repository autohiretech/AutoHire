-- AutoHire migration 057 — tell the host when PayHold couldn't collect the
-- overage automatically.
--
-- payhold-create-deal stopped setting split_percent (the 50/50 hourly split
-- is retired; every rental type now charges the full estimate up front and
-- collects any overage automatically on confirm). PayHold already fires
-- `order.balance_charge_failed` whenever that automatic collection fails —
-- a renter who paid by a method with no reusable credential, mobile money
-- above all — but nothing here was listening for it. The trip finished,
-- looked complete in AutoHire, and the host had no way to know PayHold was
-- sitting on an unpaid overage charge it was never going to collect.
--
-- `overage_collection_failed` + `_reason` are what payhold-webhook writes on
-- that event (service role, bypasses this trigger via the `uid is null`
-- escape hatch below) and what the host clears once they've collected the
-- money themselves, in person — the same shape migration 055 already gave
-- `amount_owed_rwf`, and enforced the identical way: host-only, and only in
-- the direction that ends the flag, never the direction that starts it.
--
-- Safe to re-run.

alter table bookings
  add column if not exists overage_collection_failed boolean not null default false;
alter table bookings
  add column if not exists overage_collection_failed_reason text;

create or replace function booking_enforce_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  refund_ok boolean;
  owed_ok boolean;
  collection_ok boolean;
begin
  if uid is null or is_admin() then
    return new;
  end if;

  -- A paid booking may be refunded, but only as part of a cancellation/decline.
  refund_ok := old.payment_status = 'paid'
    and new.payment_status = 'refunded'
    and new.state in ('cancelled', 'declined');

  -- The host may lower what's owed — they collected it themselves outside
  -- PayHold, or chose to waive some or all of it — never raise it.
  -- amount_exceeded_rwf is not part of this exception: it is the fixed
  -- original figure and nobody may change it once settle-usage has set it.
  owed_ok := uid = old.host_id
    and new.amount_owed_rwf >= 0
    and new.amount_owed_rwf <= old.amount_owed_rwf;

  -- The host may clear a failed-collection flag — they collected the
  -- overage from the renter in person — and only clear it: raising it is
  -- PayHold's own webhook's job, not something a host update should be able
  -- to fake. Both columns have to clear together, in the one update, so a
  -- flag can never be cleared with a stale reason left sitting behind it.
  collection_ok := uid = old.host_id
    and old.overage_collection_failed = true
    and new.overage_collection_failed = false
    and new.overage_collection_failed_reason is null;

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
     or new.amount_exceeded_rwf  is distinct from old.amount_exceeded_rwf
     or (new.amount_owed_rwf is distinct from old.amount_owed_rwf and not owed_ok)
     or (new.overage_collection_failed is distinct from old.overage_collection_failed and not collection_ok)
     or (new.overage_collection_failed_reason is distinct from old.overage_collection_failed_reason and not collection_ok) then
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
