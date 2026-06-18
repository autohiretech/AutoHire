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
  type        verification_doc_type not null,
  status      verification_status not null,
  file_name   text,
  uploaded_at date,
  note        text,
  extracted   jsonb
);

create table notifications (
  id         text primary key,
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
-- RLS is enabled on every table (Supabase best practice). For now we grant
-- public read so the browse/app works with the anon key, plus PERMISSIVE DEV
-- write policies so the mock-style mutations persist while there is no auth.
--
-- ⚠️  DEV ONLY: replace the "_dev_write" policies below with auth.uid()-scoped
-- ownership policies when Supabase Auth lands (ROADMAP Stage B step 4).

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

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','listings','bookings','payouts','conversations','messages',
    'reviews','verification_documents','notifications','flags','disputes'
  ]
  loop
    execute format('create policy %I_read on %I for select using (true);', t, t);
    -- DEV ONLY — remove once auth-scoped policies exist:
    execute format('create policy %I_dev_write on %I for all using (true) with check (true);', t, t);
  end loop;
end $$;
