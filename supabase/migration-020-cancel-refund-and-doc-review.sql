-- AutoHire migration 020 — cancellation refunds + host document review.
--
-- 1. Allow payment_status 'paid' -> 'refunded' WHEN a booking is being cancelled
--    or declined (so a participant can cancel+refund in one update). Every other
--    money/date/identity field stays immutable.
-- 2. Let a host read the verification documents of any renter who has a booking
--    (e.g. a pending request) on one of the host's cars, so they can review the
--    requester before approving.
--
-- Apply after migrations 001–019 in the Supabase SQL editor. Safe to re-run.

-- 1. Cancellation refund -------------------------------------------------------
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
     or new.created_at   is distinct from old.created_at then
    raise exception 'Booking amounts, dates and payment cannot be changed.';
  end if;

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

-- 2. Host can review a requester's documents -----------------------------------
drop policy if exists vdocs_host_read on verification_documents;
create policy vdocs_host_read on verification_documents for select
  using (exists (
    select 1 from bookings b
    where b.renter_id = verification_documents.profile_id
      and b.host_id = auth.uid()::text
  ));
