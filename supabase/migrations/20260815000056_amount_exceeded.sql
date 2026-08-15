-- AutoHire migration 056 — keep the original overage figure once a host
-- starts resolving it.
--
-- Migration 055 let a host lower `amount_owed_rwf` — mark it collected, or
-- waive part of it. That's the right control, but it has a side effect: once
-- a host acts, the ORIGINAL "how much did this exceed by" fact is gone,
-- overwritten by whatever's still outstanding. A host who waived half of a
-- 10,000 RWF overage down to 5,000 should still be able to see it was 10,000
-- to begin with — "exceeded by" and "still to pay" are two different
-- questions, and one column can't answer both once it's mutable.
--
-- `amount_exceeded_rwf` is the fixed one: written once, by
-- payhold-settle-usage, at the same moment and to the same value as
-- `amount_owed_rwf` was originally computed, and never touched again —
-- locked the same way `actual_hours`/`final_amount_rwf` already are.
-- `amount_owed_rwf` keeps its existing meaning and stays host-adjustable
-- per migration 055.
--
-- Safe to re-run.

alter table bookings
  add column if not exists amount_exceeded_rwf integer;

create or replace function booking_enforce_update() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  refund_ok boolean;
  owed_ok boolean;
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
     or (new.amount_owed_rwf is distinct from old.amount_owed_rwf and not owed_ok) then
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
