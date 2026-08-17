-- AutoHire migration 067 — host broadcasts: announcements with no trip
-- behind them, on purpose.
--
-- trip_posts (migration 064) can never carry this content — its trigger
-- refuses to exist without a paid, completed booking, and "15% off my
-- convertible this weekend" isn't about any trip at all. This is the
-- blueprint's Module 6 (Host Stories & Updates), and it needs its own table
-- precisely BECAUSE it has none of trip_posts' guarantees: nothing here is
-- independently verified, it's just a host talking to whoever follows them.
-- The UI must never present a broadcast with the trust language ("verified",
-- a checkmark) that a trip post earns.
--
-- Who can write: only a host account (is_host(), from schema.sql) posting as
-- themselves. listing_id is optional and, when set, must be a car THAT host
-- actually owns — a fleet update pointing at someone else's car would be
-- actively misleading, so it's a trigger check, not a suggestion.
--
-- Who can read: everyone. A broadcast is public by nature — the blueprint's
-- own framing is "hosts broadcast their fleet", a follow (migration 059) is
-- one-way specifically so a host can have followers with no relationship back
-- — so unlike trip_posts there is no visibility column and no circles rule.
-- Following only controls the NOTIFICATION fan-out below, never the read.
--
-- Apply after migration 059 (follows) and schema.sql (is_host(), is_admin()).
-- Safe to re-run.

create table if not exists host_broadcasts (
  id         text primary key,
  host_id    text not null references profiles(id) on delete cascade,
  body       text not null,
  listing_id text references listings(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists host_broadcasts_host_idx on host_broadcasts (host_id, created_at desc);

create or replace function host_broadcast_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.host_id and role = 'owner') then
    raise exception 'Only host accounts can post updates.';
  end if;
  if new.listing_id is not null
     and not exists (select 1 from listings where id = new.listing_id and host_id = new.host_id) then
    raise exception 'You can only post about your own listings.';
  end if;
  return new;
end $$;

drop trigger if exists host_broadcast_verify on host_broadcasts;
create trigger host_broadcast_verify before insert or update on host_broadcasts
  for each row execute function host_broadcast_guard();

alter table host_broadcasts enable row level security;

drop policy if exists host_broadcasts_read on host_broadcasts;
create policy host_broadcasts_read on host_broadcasts for select using (true);
drop policy if exists host_broadcasts_insert on host_broadcasts;
create policy host_broadcasts_insert on host_broadcasts for insert
  with check (host_id = auth.uid()::text and is_host());
drop policy if exists host_broadcasts_delete on host_broadcasts;
create policy host_broadcasts_delete on host_broadcasts for delete
  using (host_id = auth.uid()::text or is_admin());

-- ----------------------------------------------------------------------------
-- Fan out to every follower — the 'host_broadcast' notification kind
-- (migration 058) existed since Phase 1 with nothing writing to it yet.
-- ----------------------------------------------------------------------------
create or replace function host_broadcast_notify() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  host_name text;
  recipient text;
begin
  if new.host_id like 'demo-%' then
    return new;
  end if;

  select coalesce(business_name, full_name) into host_name from profiles where id = new.host_id;

  for recipient in
    select follower_id from follows where followee_id = new.host_id
  loop
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, link)
    values (
      'ntf-bcast-' || substr(md5(new.id || recipient), 1, 16),
      recipient,
      'host_broadcast',
      coalesce(host_name, 'A host you follow') || ' posted an update',
      left(new.body, 140),
      '{in_app}',
      now(),
      case when new.listing_id is not null then '/cars/' || new.listing_id else '/hosts/' || new.host_id end
    );
  end loop;
  return new;
end $$;

drop trigger if exists host_broadcast_notify_trigger on host_broadcasts;
create trigger host_broadcast_notify_trigger after insert on host_broadcasts
  for each row execute function host_broadcast_notify();
