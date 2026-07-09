-- AutoHire — Supabase schema (Stage B).
-- Derived from @autohire/shared domain types. Paste into the Supabase SQL editor
-- (or run via the Supabase CLI). IDs are kept as text to match the seeded mock
-- data (car-1, host-3, bk-1, …); when Supabase Auth lands, profile ids map to
-- auth.users via a migration.

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type owner_type        as enum ('individual', 'business');
create type user_role         as enum ('renter', 'owner', 'admin');
create type verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type car_category      as enum ('sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury',
  -- machinery: cultivating (agriculture) + building (construction)
  'tractor', 'harvester', 'tiller', 'excavator', 'bulldozer', 'loader', 'crane', 'forklift');
create type transmission      as enum ('automatic', 'manual');
create type fuel_type         as enum ('petrol', 'diesel', 'hybrid', 'electric');
create type booking_mode      as enum ('instant', 'request');
create type listing_status    as enum ('available', 'maintenance');
create type trip_state        as enum ('requested', 'confirmed', 'pickup', 'active', 'return', 'completed', 'cancelled', 'declined');
create type payout_channel    as enum ('mtn_momo', 'airtel_money', 'bank_transfer');
create type payout_status     as enum ('scheduled', 'processing', 'paid', 'failed');
create type review_direction  as enum ('renter_to_host', 'host_to_renter');
create type booking_payment_status as enum ('unpaid', 'paid', 'refunded');
create type notification_channel as enum ('sms', 'push', 'in_app');
create type notification_kind as enum ('booking_confirmation', 'pickup_reminder', 'return_reminder', 'payout_alert', 'message', 'verification');
create type verification_doc_type as enum ('drivers_license', 'national_id', 'vehicle_registration', 'insurance_certificate', 'business_registration');
create type flag_target_type  as enum ('listing', 'user');
create type flag_reason       as enum ('inappropriate', 'spam', 'fraud', 'safety', 'other');
create type moderation_status as enum ('open', 'approved', 'removed', 'dismissed');
create type dispute_status    as enum ('open', 'under_review', 'resolved_renter', 'resolved_host', 'dismissed');

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Everyone (renters, owners, admins). Host-only columns are nullable.
create table profiles (
  id              text primary key,
  full_name       text not null,
  avatar_url      text,
  email           text not null,
  phone           text not null,
  role            user_role not null,
  joined_at       date not null,
  verification    verification_status not null default 'unverified',
  rating_avg      numeric(2,1),
  rating_count    integer,
  -- host-only
  owner_type      owner_type,
  business_name   text,
  payout_terms    text,
  insurance_type  text,
  vehicle_count   integer
);

create table listings (
  id                text primary key,
  title             text not null,
  host_id           text not null references profiles(id) on delete cascade,
  owner_type        owner_type not null,
  category          car_category not null,
  make              text not null,
  model             text not null,
  year              integer not null,
  seats             integer not null,
  transmission      transmission not null,
  fuel              fuel_type not null,
  price_per_day_rwf integer not null,
  -- Currency the car is priced + charged in (ISO 4217). Kigali=RWF, Dubai=AED…
  price_currency    char(3) not null default 'RWF',
  -- Market the car sits in (ISO 3166-1 alpha-2). The country selector filters on this.
  country           char(2) not null default 'RW',
  location          text not null,
  city              text not null,
  photos            text[] not null default '{}',
  features          text[] not null default '{}',
  booking_mode      booking_mode not null,
  rating_avg        numeric(2,1) not null default 0,
  rating_count      integer not null default 0,
  blocked_dates     date[] not null default '{}',
  -- Host-set availability state. 'maintenance' + maintenance_until means the car
  -- is out of service until that date (bookings may only start on/after it).
  -- "Booked" is NOT stored here — it's derived from live bookings.
  status            listing_status not null default 'available',
  maintenance_until date,
  -- Pickup point on the map (set via the listing form's map picker).
  lat               numeric,
  lng               numeric,
  -- Optional host-provided link renters can open for directions / arrival info.
  location_url      text
);

create table bookings (
  id              text primary key,
  listing_id      text not null references listings(id) on delete cascade,
  renter_id       text not null references profiles(id) on delete cascade,
  host_id         text not null references profiles(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  days            integer not null,
  state           trip_state not null,
  subtotal_rwf    integer not null,
  service_fee_rwf integer not null,
  total_rwf       integer not null,
  -- Payment is owned server-side; a booking only ever lands here once paid.
  payment_status    booking_payment_status not null default 'unpaid',
  payment_intent_id text,
  created_at      timestamptz not null default now(),
  check_in        jsonb,
  check_out       jsonb,
  -- Two-sided handoff: pickup and return each need both sign-offs (see
  -- confirm_handoff() + booking_enforce_update()).
  pickup_renter_at timestamptz,
  pickup_host_at   timestamptz,
  return_renter_at timestamptz,
  return_host_at   timestamptz,
  -- Set once an "overdue return" notification has been sent for this booking.
  overdue_notified_at timestamptz
);

-- One booking per Stripe PaymentIntent (idempotent confirm, no double-spend).
create unique index if not exists bookings_payment_intent_id_key
  on bookings (payment_intent_id)
  where payment_intent_id is not null;

create table payouts (
  id            text primary key,
  booking_id    text not null references bookings(id) on delete cascade,
  host_id       text not null references profiles(id) on delete cascade,
  amount_rwf    integer not null,
  channel       payout_channel not null,
  status        payout_status not null,
  scheduled_for date not null,
  paid_at       date
);

create table conversations (
  id                   text primary key,
  listing_id           text not null references listings(id) on delete cascade,
  renter_id            text not null references profiles(id) on delete cascade,
  host_id              text not null references profiles(id) on delete cascade,
  last_message_preview text not null,
  last_message_at      timestamptz not null,
  unread               integer not null default 0
);

create table messages (
  id              text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  sender_id       text not null references profiles(id) on delete cascade,
  body            text not null,
  sent_at         timestamptz not null,
  read_at         timestamptz,
  -- Optional shared file/image, a quoted message, and emoji reactions.
  attachment_url  text,
  attachment_type text,
  attachment_name text,
  reply_to        text references messages(id) on delete set null,
  reactions       jsonb not null default '{}'::jsonb
);

create table reviews (
  id         text primary key,
  booking_id text not null references bookings(id) on delete cascade,
  author_id  text not null references profiles(id) on delete cascade,
  subject_id text not null references profiles(id) on delete cascade,
  direction  review_direction not null,
  rating     integer not null check (rating between 1 and 5),
  body       text not null,
  created_at timestamptz not null default now()
);

create table verification_documents (
  id          text primary key,
  profile_id  text not null references profiles(id) on delete cascade,
  type        verification_doc_type not null,
  status      verification_status not null,
  file_name   text,
  uploaded_at date,
  note        text,
  extracted   jsonb
);

create table notifications (
  id         text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  kind       notification_kind not null,
  title      text not null,
  body       text not null,
  channels   notification_channel[] not null default '{}',
  created_at timestamptz not null,
  read       boolean not null default false
);

create table flags (
  id           text primary key,
  target_type  flag_target_type not null,
  target_id    text not null,
  target_label text not null,
  reason       flag_reason not null,
  detail       text not null,
  reported_by  text not null references profiles(id) on delete cascade,
  created_at   timestamptz not null,
  status       moderation_status not null default 'open'
);

create table disputes (
  id         text primary key,
  booking_id text not null references bookings(id) on delete cascade,
  raised_by  text not null references profiles(id) on delete cascade,
  against    text not null references profiles(id) on delete cascade,
  reason     text not null,
  amount_rwf integer not null,
  created_at timestamptz not null,
  status     dispute_status not null default 'open'
);

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- ----------------------------------------------------------------------------
-- RLS is enabled on every table (Supabase best practice). Profile ids equal the
-- Supabase Auth uid (the app keys `profiles.id` to auth.uid under the
-- "fresh signups start empty" model), so ownership checks compare against
-- `auth.uid()::text`.
--
-- Re-runnable: drop existing policies first so this block can be pasted again.

alter table profiles               enable row level security;
alter table listings               enable row level security;
alter table bookings               enable row level security;
alter table payouts                enable row level security;
alter table conversations          enable row level security;
alter table messages               enable row level security;
alter table reviews                enable row level security;
alter table verification_documents enable row level security;
alter table notifications          enable row level security;
alter table flags                  enable row level security;
alter table disputes               enable row level security;

-- Drop any previously-created policies (idempotent re-paste).
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I;', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Helper expression used throughout: auth.uid()::text  ==  profiles.id

-- is_admin(): true when the logged-in user's profile has the 'admin' role.
-- Provision an admin by setting profiles.role = 'admin' for their uid.
-- SECURITY DEFINER so the lookup isn't itself blocked by profiles RLS.
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()::text and p.role = 'admin'
  );
$$;

-- is_host(): true when the logged-in user's profile is a host (role 'owner').
-- Gate for creating listings — a renter must become a host first.
create or replace function is_host() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()::text and p.role = 'owner'
  );
$$;

-- profiles: anyone can read (public host/renter pages); you may insert/update
-- only your own row.
create policy profiles_read   on profiles for select using (true);
create policy profiles_insert on profiles for insert with check (id = auth.uid()::text);
create policy profiles_update on profiles for update using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- listings: public browse; only the owning host can manage their listings, and
-- only a host account (role 'owner') may create one — renters can't list.
create policy listings_read   on listings for select using (true);
create policy listings_insert on listings for insert
  with check (host_id = auth.uid()::text and (is_host() or is_admin()));
create policy listings_update on listings for update
  using (host_id = auth.uid()::text) with check (host_id = auth.uid()::text);
create policy listings_delete on listings for delete
  using (host_id = auth.uid()::text);

-- bookings: visible to the renter or the host on the booking. There is NO
-- client insert policy on purpose — bookings are created only by the
-- `confirm-booking` Edge Function (service role) after a Stripe payment
-- succeeds, so a paid booking can't exist without real money. Either party may
-- update, but the booking_enforce trigger restricts WHAT may change (amounts /
-- dates are immutable; status follows a strict state machine).
create policy bookings_read   on bookings for select
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin());
create policy bookings_update on bookings for update
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin())
  with check (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin());

-- payouts: read-only to the host they belong to (writes happen server-side).
create policy payouts_read on payouts for select
  using (host_id = auth.uid()::text or is_admin());

-- conversations / messages: limited to the two participants.
create policy conversations_read   on conversations for select
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text);
create policy conversations_write  on conversations for all
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text)
  with check (renter_id = auth.uid()::text or host_id = auth.uid()::text);
create policy messages_read on messages for select
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and (c.renter_id = auth.uid()::text or c.host_id = auth.uid()::text)
  ));
create policy messages_insert on messages for insert
  with check (sender_id = auth.uid()::text);
create policy messages_update on messages for update
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and (c.renter_id = auth.uid()::text or c.host_id = auth.uid()::text)
  ));
create policy messages_delete on messages for delete
  using (sender_id = auth.uid()::text);

-- reviews: public read (shown on listings/profiles); you author as yourself.
create policy reviews_read   on reviews for select using (true);
create policy reviews_insert on reviews for insert with check (author_id = auth.uid()::text);

-- flags / disputes: a reporter files as themselves and sees their own reports;
-- admins see and resolve everything (the /admin moderation queue).
create policy flags_read   on flags for select
  using (reported_by = auth.uid()::text or is_admin());
create policy flags_insert on flags for insert with check (reported_by = auth.uid()::text);
create policy flags_update on flags for update using (is_admin()) with check (is_admin());
create policy disputes_read   on disputes for select
  using (raised_by = auth.uid()::text or against = auth.uid()::text or is_admin());
create policy disputes_insert on disputes for insert with check (raised_by = auth.uid()::text);
create policy disputes_update on disputes for update using (is_admin()) with check (is_admin());

-- verification_documents / notifications: scoped to the owning profile; admins
-- can read all (verification review queue / support).
create policy vdocs_read   on verification_documents for select
  using (profile_id = auth.uid()::text or is_admin());
-- A host may review the documents of a renter who has a booking on their car.
create policy vdocs_host_read on verification_documents for select
  using (exists (
    select 1 from bookings b
    where b.renter_id = verification_documents.profile_id
      and b.host_id = auth.uid()::text
  ));
create policy vdocs_write  on verification_documents for all
  using (profile_id = auth.uid()::text) with check (profile_id = auth.uid()::text);
create policy notifications_read  on notifications for select
  using (profile_id = auth.uid()::text or is_admin());
create policy notifications_write on notifications for all
  using (profile_id = auth.uid()::text) with check (profile_id = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- Booking integrity triggers (kept in sync with migration 005)
-- ----------------------------------------------------------------------------
-- These fire even for the service role, so amounts, availability and the
-- status state-machine hold no matter who writes the row.

-- Availability: reject blocked dates and overlapping live bookings.
-- SECURITY DEFINER so the overlap check sees every booking, not just the
-- caller's RLS-visible rows.
create or replace function booking_check_availability() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  blocked       date[];
  l_status      listing_status;
  maint_until   date;
begin
  if new.end_date <= new.start_date then
    raise exception 'Return date must be after pick-up date.';
  end if;

  select blocked_dates, status, maintenance_until
    into blocked, l_status, maint_until
    from listings where id = new.listing_id;

  -- In maintenance? Bookings may only start once the car is back in service.
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

drop trigger if exists booking_availability on bookings;
create trigger booking_availability
  before insert or update of start_date, end_date, listing_id, state on bookings
  for each row execute function booking_check_availability();

-- Booked date ranges for a listing, exposed safely to anyone (no renter identity
-- or amounts — just the start/end of each live booking) so the booking UI can
-- show which dates are taken. SECURITY DEFINER to bypass per-row booking RLS.
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

-- Status lock: immutable money/date/payment fields + role-scoped state machine.
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

drop trigger if exists booking_enforce on bookings;
create trigger booking_enforce
  before update on bookings
  for each row execute function booking_enforce_update();

-- The single handoff path: stamps the caller's slot, appends proof photos, and
-- advances the state once both renter and host have signed off for that phase.
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

-- A host can't block dates that fall inside an existing live booking.
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

-- Notify the host on a new booking. (Messages are intentionally NOT notified
-- here — they have their own unread badge + chime.) SECURITY DEFINER so it can
-- write the recipient's notification row, which RLS otherwise forbids.
create or replace function notify_on_booking() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('ntf-' || gen_random_uuid(), new.host_id, 'booking_confirmation',
          case when new.state = 'requested' then 'New booking request' else 'New booking' end,
          'A renter ' || (case when new.state = 'requested' then 'requested' else 'booked' end)
            || ' your car for ' || new.start_date || ' to ' || new.end_date || '.',
          '{in_app}', now(), false);
  return new;
end $$;

drop trigger if exists booking_notify on bookings;
create trigger booking_notify after insert on bookings
  for each row execute function notify_on_booking();

-- Notify on booking actions (approve/decline/cancel, trip active/complete) and
-- on handoff proof uploaded by one side.
create or replace function create_notification(
  p_profile text, p_kind notification_kind, p_title text, p_body text
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

  if new.state is distinct from old.state then
    if new.state = 'confirmed' then
      perform create_notification(new.renter_id, 'booking_confirmation', 'Booking confirmed', 'The host confirmed your booking.');
    elsif new.state = 'declined' then
      perform create_notification(new.renter_id, 'booking_confirmation', 'Booking declined', 'The host declined your booking request.');
    elsif new.state = 'active' then
      perform create_notification(new.renter_id, 'pickup_reminder', 'Trip started', 'Both sides confirmed pickup — your trip is now active.');
      perform create_notification(new.host_id,  'pickup_reminder', 'Trip started', 'Both sides confirmed pickup — the trip is now active.');
    elsif new.state = 'completed' then
      perform create_notification(new.renter_id, 'return_reminder', 'Trip completed', 'Both sides confirmed return — the trip is complete.');
      perform create_notification(new.host_id,  'return_reminder', 'Trip completed', 'Both sides confirmed return — the trip is complete.');
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

-- Overdue returns: notify host + renter when a trip's end date passed but the
-- car isn't returned/completed. Fires once per booking. Called by pg_cron
-- (uid null = all bookings) and on dashboard load (scoped to the caller's own).
create or replace function notify_overdue_returns() returns void
  language plpgsql security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  r record;
begin
  for r in
    select * from bookings b
    where b.state in ('confirmed', 'pickup', 'active', 'return')
      and b.end_date < current_date
      and b.overdue_notified_at is null
      and (uid is null or b.host_id = uid or b.renter_id = uid)
  loop
    perform create_notification(r.host_id, 'return_reminder', 'Car overdue',
      'A trip on your car was due back on ' || r.end_date || ' but is not completed yet.');
    perform create_notification(r.renter_id, 'return_reminder', 'Return overdue',
      'Your rental was due back on ' || r.end_date || '. Please return the car and confirm.');
    update bookings set overdue_notified_at = now() where id = r.id;
  end loop;
end $$;
grant execute on function notify_overdue_returns() to authenticated;
