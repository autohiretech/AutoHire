-- AutoHire migration 043 — a real watchlist: watch a car, get told when it frees up.
--
-- "Watch" was browser-only (a localStorage array), so it did nothing but colour
-- a button — nobody was ever told when the car they wanted became available.
-- This stores the watch server-side and notifies every watcher when the car
-- comes back into service or a trip on it ends.
--
-- Hosts and companies can't book, but they can watch — the notification is
-- suppressed only for the car's own host (they don't need telling).
--
-- NOTE: run the `alter type` statement first and let it commit before anything
-- writes a 'watchlist' notification — Postgres won't use a new enum value in
-- the same transaction that added it.
--
-- Apply after migrations 001–042. Safe to re-run.

alter type notification_kind add value if not exists 'watchlist';

-- Where an "Open" action should take the reader, when the notification points
-- at something specific (a car, a trip). Null keeps the old kind-based routing.
alter table notifications add column if not exists link text;

create table if not exists watchlist (
  profile_id text not null references profiles(id)  on delete cascade,
  listing_id text not null references listings(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, listing_id)
);

-- The notify path looks watchers up by car.
create index if not exists watchlist_listing_id_idx on watchlist (listing_id);

alter table watchlist enable row level security;

-- Your watchlist is yours: you may only see or change your own rows.
drop policy if exists watchlist_read   on watchlist;
drop policy if exists watchlist_insert on watchlist;
drop policy if exists watchlist_delete on watchlist;
create policy watchlist_read   on watchlist for select
  using (profile_id = auth.uid()::text);
create policy watchlist_insert on watchlist for insert
  with check (profile_id = auth.uid()::text);
create policy watchlist_delete on watchlist for delete
  using (profile_id = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- Notifying watchers
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER: notifications RLS only lets you insert rows for yourself,
-- so the watcher's row has to be written server-side.
create or replace function notify_watchers(p_listing_id text, p_title text, p_body text)
  returns void language plpgsql security definer set search_path = public as $$
declare
  w         record;
  l_title   text;
  l_host    text;
begin
  select title, host_id into l_title, l_host from listings where id = p_listing_id;
  if l_title is null then return; end if;

  for w in
    select profile_id from watchlist
    where listing_id = p_listing_id
      and profile_id is distinct from l_host  -- the host knows; don't tell them
  loop
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
    values (
      'ntf-' || gen_random_uuid(),
      w.profile_id,
      'watchlist',
      p_title,
      l_title || ' — ' || p_body,
      '{in_app}',
      now(),
      false,
      '/cars/' || p_listing_id
    );
  end loop;
end $$;

-- A car you're watching comes back into service (out of maintenance, relisted).
create or replace function notify_watchers_on_listing() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'available' and old.status is distinct from 'available' then
    perform notify_watchers(new.id, 'A car you''re watching is available',
      'it''s back in service and open for booking.');
  end if;
  return new;
end $$;

drop trigger if exists listing_watch_notify on listings;
create trigger listing_watch_notify after update of status on listings
  for each row execute function notify_watchers_on_listing();

-- The trip that was holding a car you're watching has ended or fallen through,
-- so its dates are open again.
create or replace function notify_watchers_on_booking() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.state in ('cancelled', 'declined', 'completed')
     and old.state not in ('cancelled', 'declined', 'completed')
     -- Only when nothing else is holding the car — a fleet car with a queue of
     -- trips behind this one isn't actually free.
     and not exists (
       select 1 from bookings b
       where b.listing_id = new.listing_id
         and b.id <> new.id
         and b.state not in ('cancelled', 'declined', 'completed')
     ) then
    perform notify_watchers(new.listing_id, 'A car you''re watching is free again',
      'the trip on it ended — those dates are open.');
  end if;
  return new;
end $$;

drop trigger if exists booking_watch_notify on bookings;
create trigger booking_watch_notify after update of state on bookings
  for each row execute function notify_watchers_on_booking();
