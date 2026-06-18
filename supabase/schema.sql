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
create type car_category      as enum ('sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury');
create type transmission      as enum ('automatic', 'manual');
create type fuel_type         as enum ('petrol', 'diesel', 'hybrid', 'electric');
create type booking_mode      as enum ('instant', 'request');
create type trip_state        as enum ('requested', 'confirmed', 'pickup', 'active', 'return', 'completed', 'cancelled', 'declined');
create type payout_channel    as enum ('mtn_momo', 'airtel_money', 'bank_transfer');
create type payout_status     as enum ('scheduled', 'processing', 'paid', 'failed');
create type review_direction  as enum ('renter_to_host', 'host_to_renter');
create type notification_channel as enum ('sms', 'push', 'in_app');
create type notification_kind as enum ('booking_confirmation', 'pickup_reminder', 'return_reminder', 'payout_alert', 'message', 'verification');
create type verification_doc_type as enum ('drivers_license', 'national_id', 'vehicle_registration', 'insurance_certificate');
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
  host_id           text not null references profiles(id),
  owner_type        owner_type not null,
  category          car_category not null,
  make              text not null,
  model             text not null,
  year              integer not null,
  seats             integer not null,
  transmission      transmission not null,
  fuel              fuel_type not null,
  price_per_day_rwf integer not null,
  location          text not null,
  city              text not null,
  photos            text[] not null default '{}',
  features          text[] not null default '{}',
  booking_mode      booking_mode not null,
  rating_avg        numeric(2,1) not null default 0,
  rating_count      integer not null default 0,
  blocked_dates     date[] not null default '{}'
);

create table bookings (
  id              text primary key,
  listing_id      text not null references listings(id),
  renter_id       text not null references profiles(id),
  host_id         text not null references profiles(id),
  start_date      date not null,
  end_date        date not null,
  days            integer not null,
  state           trip_state not null,
  subtotal_rwf    integer not null,
  service_fee_rwf integer not null,
  total_rwf       integer not null,
  created_at      timestamptz not null default now(),
  check_in        jsonb,
  check_out       jsonb
);

create table payouts (
  id            text primary key,
  booking_id    text not null references bookings(id),
  host_id       text not null references profiles(id),
  amount_rwf    integer not null,
  channel       payout_channel not null,
  status        payout_status not null,
  scheduled_for date not null,
  paid_at       date
);

create table conversations (
  id                   text primary key,
  listing_id           text not null references listings(id),
  renter_id            text not null references profiles(id),
  host_id              text not null references profiles(id),
  last_message_preview text not null,
  last_message_at      timestamptz not null,
  unread               integer not null default 0
);

create table messages (
  id              text primary key,
  conversation_id text not null references conversations(id),
  sender_id       text not null references profiles(id),
  body            text not null,
  sent_at         timestamptz not null,
  read_at         timestamptz
);

create table reviews (
  id         text primary key,
  booking_id text not null references bookings(id),
  author_id  text not null references profiles(id),
  subject_id text not null references profiles(id),
  direction  review_direction not null,
  rating     integer not null check (rating between 1 and 5),
  body       text not null,
  created_at timestamptz not null default now()
);

create table verification_documents (
  id          text primary key,
  profile_id  text not null references profiles(id),
  type        verification_doc_type not null,
  status      verification_status not null,
  file_name   text,
  uploaded_at date,
  note        text,
  extracted   jsonb
);

create table notifications (
  id         text primary key,
  profile_id text not null references profiles(id),
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
  reported_by  text not null references profiles(id),
  created_at   timestamptz not null,
  status       moderation_status not null default 'open'
);

create table disputes (
  id         text primary key,
  booking_id text not null references bookings(id),
  raised_by  text not null references profiles(id),
  against    text not null references profiles(id),
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

-- profiles: anyone can read (public host/renter pages); you may insert/update
-- only your own row.
create policy profiles_read   on profiles for select using (true);
create policy profiles_insert on profiles for insert with check (id = auth.uid()::text);
create policy profiles_update on profiles for update using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- listings: public browse; only the owning host can write their listings.
create policy listings_read   on listings for select using (true);
create policy listings_write  on listings for all
  using (host_id = auth.uid()::text) with check (host_id = auth.uid()::text);

-- bookings: visible to the renter or the host on the booking; the renter creates
-- them; either party may update (host approves/declines, renter cancels).
create policy bookings_read   on bookings for select
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin());
create policy bookings_insert on bookings for insert
  with check (renter_id = auth.uid()::text);
create policy bookings_update on bookings for update
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text)
  with check (renter_id = auth.uid()::text or host_id = auth.uid()::text);

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
create policy vdocs_write  on verification_documents for all
  using (profile_id = auth.uid()::text) with check (profile_id = auth.uid()::text);
create policy notifications_read  on notifications for select
  using (profile_id = auth.uid()::text or is_admin());
create policy notifications_write on notifications for all
  using (profile_id = auth.uid()::text) with check (profile_id = auth.uid()::text);
