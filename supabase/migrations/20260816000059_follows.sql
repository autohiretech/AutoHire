-- AutoHire migration 059 — the social graph: one-way follows.
--
-- Why following and not friendship. Migration 042 made it a trigger-level fact
-- that a host (role 'owner') can never appear as `renter_id`, and appMode.tsx
-- routes owners into the Hosting view entirely — a personal account that lists
-- one car BECOMES a host and stops renting. A symmetric friend graph would
-- therefore have to either exclude every host, who are exactly the people worth
-- following, or unpick migration 042, which sits directly on the payment path.
-- A one-way follow has neither problem: it needs no reciprocity, no accept
-- state machine, and no opinion about what either party is allowed to do.
--
-- So this table is deliberately ROLE-AGNOSTIC. Note the absence of the
-- `is_host()` guard that migration 044 put on watchlist_insert: watching is a
-- renter's tool because only a renter can act on it, but anyone can follow
-- anyone, and a host following another host is a normal thing to want.
--
-- On reading it: the table holds ids and nothing else, so `follows_read` is
-- open. Names and avatars must be joined from `public_profiles` — the PII-free
-- view migration 029 created — and NEVER from `profiles`, which since 029 is
-- readable only by yourself, an admin, or a booking/conversation counterparty.
-- Joining `profiles` here would silently return zero rows for strangers, which
-- is the failure mode to watch for when a follower list renders empty.
--
-- Apply after migration 058. Safe to re-run.

create table if not exists follows (
  follower_id text not null references profiles(id) on delete cascade,
  followee_id text not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  -- You cannot follow yourself. Cheap to enforce, awkward to clean up later.
  constraint follows_not_self check (follower_id <> followee_id)
);

-- The PK covers "who am I following"; this covers "who follows them", which is
-- what a profile page's follower count and the social-proof badge both ask.
create index if not exists follows_followee_idx on follows (followee_id);

alter table follows enable row level security;

drop policy if exists follows_read on follows;
create policy follows_read on follows for select using (true);

drop policy if exists follows_insert on follows;
create policy follows_insert on follows for insert
  with check (follower_id = auth.uid()::text);

-- Unfollowing is yours alone. There is deliberately no "remove a follower":
-- blocking is the tool for that, and it belongs with the flags/moderation work
-- rather than here.
drop policy if exists follows_delete on follows;
create policy follows_delete on follows for delete
  using (follower_id = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- "X started following you"
-- ----------------------------------------------------------------------------
-- Fires on the same rails as every other notification (migration 015 set the
-- pattern; 052 added the deep link). SECURITY DEFINER because the insert into
-- `notifications` is on the followee's behalf, not the follower's, and the
-- notifications insert policy would refuse it otherwise.
create or replace function follow_notify() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  follower_name text;
begin
  -- Seeded demo accounts must not generate notifications for real people.
  if new.follower_id like 'demo-%' then
    return new;
  end if;

  select full_name into follower_name from profiles where id = new.follower_id;

  insert into notifications (id, profile_id, kind, title, body, channels, created_at, link)
  values (
    'ntf-follow-' || substr(md5(new.follower_id || new.followee_id || clock_timestamp()::text), 1, 16),
    new.followee_id,
    'social_follow',
    coalesce(follower_name, 'Someone') || ' started following you',
    'They will see your trips and announcements in their feed.',
    '{in_app}',
    now(),
    '/u/' || new.follower_id
  );
  return new;
end $$;

drop trigger if exists follow_notify_trigger on follows;
create trigger follow_notify_trigger after insert on follows
  for each row execute function follow_notify();
