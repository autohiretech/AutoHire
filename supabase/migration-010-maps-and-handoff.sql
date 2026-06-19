-- AutoHire migration 010 — real map coordinates + two-sided handoff with proof.
--
-- A. Listings gain lat/lng so pickup is a real point on a map.
-- B. Bookings gain four handoff timestamps. Pickup and return each require BOTH
--    the renter AND the host to confirm (with proof photos). A step only advances
--    when both sides have signed off:
--       confirmed → (both confirm pickup) → active
--       active    → (both confirm return) → completed
--    Photos are appended to check_in / check_out. The confirm_handoff() function
--    is the single path; the status trigger enforces that each side can only sign
--    its OWN slot and that 'active'/'completed' need both slots filled.
--
-- Apply after migrations 001–009 in the Supabase SQL editor. Safe to re-run.

-- A. Map coordinates -----------------------------------------------------------
alter table listings
  add column if not exists lat numeric,
  add column if not exists lng numeric;

-- B. Handoff sign-off timestamps ----------------------------------------------
alter table bookings
  add column if not exists pickup_renter_at timestamptz,
  add column if not exists pickup_host_at   timestamptz,
  add column if not exists return_renter_at timestamptz,
  add column if not exists return_host_at   timestamptz;

-- Status lock + handoff rules.
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

  -- State machine.
  if new.state is distinct from old.state then
    if not (uid = old.renter_id or uid = old.host_id) then
      raise exception 'Only the renter or host may change this booking.';
    end if;

    if new.state in ('cancelled', 'declined') then
      -- Host declines a request or cancels before pickup; renter cancels early.
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
      -- Forward transitions. Either participant may drive a handoff, but reaching
      -- 'active'/'completed' requires BOTH sign-offs to be present.
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

-- The single handoff path: stamps the caller's slot, appends proof photos, and
-- advances the state when both sides have signed off. SECURITY DEFINER, but
-- auth.uid() still identifies the caller so the trigger's ownership rules apply.
create or replace function confirm_handoff(
  p_booking_id text,
  p_phase      text,
  p_photos     jsonb default '[]'::jsonb
) returns bookings
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  b bookings;
  is_renter boolean;
  is_host boolean;
  both_signed boolean;
  new_state trip_state;
begin
  if uid is null then raise exception 'Not signed in.'; end if;
  select * into b from bookings where id = p_booking_id;
  if not found then raise exception 'Trip not found.'; end if;

  is_renter := uid = b.renter_id;
  is_host   := uid = b.host_id;
  if not (is_renter or is_host) then raise exception 'Not your trip.'; end if;

  if p_phase = 'pickup' then
    if b.state not in ('confirmed', 'pickup') then
      raise exception 'Pickup can only be confirmed on a confirmed trip.';
    end if;
    if is_renter and b.pickup_renter_at is null then b.pickup_renter_at := now(); end if;
    if is_host   and b.pickup_host_at   is null then b.pickup_host_at   := now(); end if;
    b.check_in := coalesce(b.check_in, '[]'::jsonb) || coalesce(p_photos, '[]'::jsonb);
    both_signed := b.pickup_renter_at is not null and b.pickup_host_at is not null;
    new_state := case when both_signed then 'active' else 'pickup' end;

  elsif p_phase = 'return' then
    if b.state not in ('active', 'return') then
      raise exception 'Return can only be confirmed on an active trip.';
    end if;
    if is_renter and b.return_renter_at is null then b.return_renter_at := now(); end if;
    if is_host   and b.return_host_at   is null then b.return_host_at   := now(); end if;
    b.check_out := coalesce(b.check_out, '[]'::jsonb) || coalesce(p_photos, '[]'::jsonb);
    both_signed := b.return_renter_at is not null and b.return_host_at is not null;
    new_state := case when both_signed then 'completed' else 'return' end;

  else
    raise exception 'Unknown handoff phase: %', p_phase;
  end if;

  update bookings set
    pickup_renter_at = b.pickup_renter_at,
    pickup_host_at   = b.pickup_host_at,
    return_renter_at = b.return_renter_at,
    return_host_at   = b.return_host_at,
    check_in         = b.check_in,
    check_out        = b.check_out,
    state            = new_state
  where id = p_booking_id
  returning * into b;

  return b;
end $$;
grant execute on function confirm_handoff(text, text, jsonb) to authenticated;
