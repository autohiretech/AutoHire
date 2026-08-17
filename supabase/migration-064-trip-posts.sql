-- AutoHire migration 064 — trip posts: the verified feed.
--
-- The one rule the whole social layer is built to make true: a post must be
-- anchored to a paid, completed booking the author was actually on. By the
-- time a booking reaches `state = 'completed'` with `payment_status = 'paid'`,
-- four independent systems have already vouched for both parties — KYC
-- (migrations 031-035), PayHold moving real money, the two-sided handoff
-- (pickup + return, both sides), and the booking state machine itself. So
-- "Trusted by 3 friends" isn't a claim a user typed in; it's a fact the ledger
-- already checked. trip_post_guard() is a trigger, not a UI rule, because a
-- claim like that is worthless if there's a code path that can fake it.
--
-- The one exception is seeded demo content (migration 065), namespaced to
-- `demo-post-%` so the escape hatch this creates is fully self-cleaning:
-- `delete from trip_posts where id like 'demo-post-%'` removes every row it
-- ever allowed through. Demo posts can never leak into "Trusted by your
-- circle" (migration 060) for a structural reason, not a filter someone has
-- to remember to keep in place: that badge is built entirely from `bookings`
-- rows, and a demo-post-% row has no booking behind it — there IS nothing for
-- social_proof_for_listing to find. A demo post can fill the feed; it can
-- never be told to a renter as if a real person vouched for a car.
--
-- listing_id is denormalized onto the post (never read by joining bookings)
-- for a privacy reason, not a performance one: the feed renders the car and
-- "Rent this exact car" WITHOUT a reader ever gaining a path to the booking
-- row itself — bookings_read stays exactly as restrictive as it's always been.
--
-- Default visibility is 'circles', not 'public'. A first post shouldn't
-- silently land on a public timeline; that's the blueprint's "choose
-- visibility before it's shared" requirement (Section 7), satisfied by the
-- default rather than a dialog nobody reads.
--
-- Apply after migration 063. Safe to re-run.

create type post_visibility as enum ('public', 'circles', 'private');

create table if not exists trip_posts (
  id         text primary key,
  author_id  text not null references profiles(id) on delete cascade,
  -- Null is legal ONLY for demo-post-% rows — see trip_post_guard() below.
  booking_id text references bookings(id) on delete cascade,
  listing_id text references listings(id) on delete set null,
  body       text not null default '',
  photos     text[] not null default '{}',
  visibility post_visibility not null default 'circles',
  city       text,
  country    char(2),
  created_at timestamptz not null default now()
);

create index if not exists trip_posts_author_idx on trip_posts (author_id, created_at desc);
create index if not exists trip_posts_listing_idx on trip_posts (listing_id);

create or replace function trip_post_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
begin
  if new.booking_id is null then
    if new.id like 'demo-post-%' then
      return new;
    end if;
    raise exception 'A post must be about a trip you actually took.';
  end if;

  select * into b from bookings where id = new.booking_id;
  if not found then
    raise exception 'Unknown trip.';
  end if;

  if new.author_id <> b.renter_id and new.author_id <> b.host_id then
    raise exception 'Only the renter or the host on a trip may post about it.';
  end if;

  -- Both halves matter: 'completed' alone would let a cancelled-then-refunded
  -- trip through, and 'paid' alone would let a trip that never happened
  -- through.
  if b.state <> 'completed' or b.payment_status <> 'paid' then
    raise exception 'You can post once the trip is finished and settled.';
  end if;

  if new.listing_id is null then
    new.listing_id := b.listing_id;
  end if;
  return new;
end $$;

drop trigger if exists trip_post_verify on trip_posts;
create trigger trip_post_verify before insert or update on trip_posts
  for each row execute function trip_post_guard();

alter table trip_posts enable row level security;

drop policy if exists trip_posts_read on trip_posts;
create policy trip_posts_read on trip_posts for select using (
  visibility = 'public'
  or author_id = auth.uid()::text
  or (visibility = 'circles' and shares_circle(author_id))
  or is_admin()
);
drop policy if exists trip_posts_insert on trip_posts;
create policy trip_posts_insert on trip_posts for insert
  with check (author_id = auth.uid()::text);
drop policy if exists trip_posts_update on trip_posts;
create policy trip_posts_update on trip_posts for update
  using (author_id = auth.uid()::text) with check (author_id = auth.uid()::text);
drop policy if exists trip_posts_delete on trip_posts;
create policy trip_posts_delete on trip_posts for delete
  using (author_id = auth.uid()::text);
