-- AutoHire migration 061 — circles: named groups, useful at n=3.
--
-- Why circles alongside follow rather than a symmetric friend graph doing
-- both jobs: follow (migration 059) covers broadcast — one-way, no accept
-- step, works for a host with thousands of followers. Circles cover
-- intimacy — a small named group with a shared purpose: a road-trip crew, a
-- farming cooperative sharing a tractor, a company's driver pool. Two
-- relationship types, not three: there is deliberately no reciprocal
-- "friend request" state machine, because follow plus circles already cover
-- both jobs a friend graph would have done.
--
-- The circle_members RLS footgun. A read policy on circle_members that
-- itself queries circle_members ("can I see this row if I'm in the same
-- circle as its owner") recurses under Postgres RLS — the classic Supabase
-- trap. shares_circle() breaks the recursion by being SECURITY DEFINER,
-- which runs with the function owner's privileges and so is not itself
-- subject to circle_members' RLS.
--
-- Apply after migration 060. Safe to re-run.

create type circle_kind as enum ('crew', 'cooperative', 'team', 'family');
create type circle_member_status as enum ('invited', 'active', 'left');

create table if not exists circles (
  id         text primary key,
  name       text not null,
  kind       circle_kind not null default 'crew',
  created_by text not null references profiles(id) on delete cascade,
  country    char(2),
  created_at timestamptz not null default now()
);

create table if not exists circle_members (
  circle_id  text not null references circles(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  status     circle_member_status not null default 'invited',
  joined_at  timestamptz not null default now(),
  primary key (circle_id, profile_id)
);

create index if not exists circle_members_profile_idx on circle_members (profile_id);

-- Do I share an active circle with this person? Used by trip_posts (061) to
-- decide 'circles'-visibility reads, and safe to reuse anywhere else that
-- needs the same question answered.
create or replace function shares_circle(other text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_members a
    join circle_members b on b.circle_id = a.circle_id
    where a.profile_id = auth.uid()::text
      and b.profile_id = other
      and a.status = 'active' and b.status = 'active'
  );
$$;

-- Am I an active member of this circle? SECURITY DEFINER for the same
-- recursion reason as shares_circle — a circle_members policy cannot safely
-- query circle_members directly.
create or replace function is_circle_member(p_circle_id text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_members
    where circle_id = p_circle_id and profile_id = auth.uid()::text and status = 'active'
  );
$$;

-- Am I the owner of this circle?
create or replace function is_circle_owner(p_circle_id text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_members
    where circle_id = p_circle_id and profile_id = auth.uid()::text
      and status = 'active' and role = 'owner'
  );
$$;

-- Is this circle's creator me, and does it not have an owner-member row yet?
-- Scopes the "seed yourself as owner" path in circle_members_insert to the
-- one moment it's legitimate — circle creation — so it can't be reused to
-- self-promote into an existing circle later. Defined before the policy
-- below references it: CREATE POLICY resolves the function at creation time.
create or replace function created_by_self(p_circle_id text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circles c
    where c.id = p_circle_id and c.created_by = auth.uid()::text
  )
  and not exists (
    select 1 from circle_members m where m.circle_id = p_circle_id and m.role = 'owner'
  );
$$;

alter table circles enable row level security;
alter table circle_members enable row level security;

-- circles: visible to members (any status — an invite must be able to see
-- what it's an invite TO) and to the creator; created freely by any
-- signed-in account, no is_host()-style gate — a circle is a renter tool as
-- much as a host one.
drop policy if exists circles_read on circles;
create policy circles_read on circles for select using (
  created_by = auth.uid()::text
  or exists (
    select 1 from circle_members m
    where m.circle_id = circles.id and m.profile_id = auth.uid()::text
  )
  or is_admin()
);
drop policy if exists circles_insert on circles;
create policy circles_insert on circles for insert
  with check (created_by = auth.uid()::text);
drop policy if exists circles_update on circles;
create policy circles_update on circles for update
  using (is_circle_owner(id)) with check (is_circle_owner(id));
drop policy if exists circles_delete on circles;
create policy circles_delete on circles for delete
  using (created_by = auth.uid()::text);

-- circle_members: a member sees their own row and their fellow members' rows
-- (via the definer functions, not a self-referencing subquery); the circle
-- owner or the invitee themselves can write.
drop policy if exists circle_members_read on circle_members;
create policy circle_members_read on circle_members for select using (
  profile_id = auth.uid()::text
  or is_circle_member(circle_id)
  or is_circle_owner(circle_id)
  or is_admin()
);
drop policy if exists circle_members_insert on circle_members;
create policy circle_members_insert on circle_members for insert
  with check (
    -- The creator seeding themselves as the first owner-member, ...
    (profile_id = auth.uid()::text and created_by_self(circle_id))
    -- ...or the circle's owner inviting someone else in.
    or is_circle_owner(circle_id)
  );
drop policy if exists circle_members_update on circle_members;
create policy circle_members_update on circle_members for update
  using (
    -- Accept/decline your own invite, or leave.
    profile_id = auth.uid()::text
    or is_circle_owner(circle_id)
  )
  with check (
    profile_id = auth.uid()::text
    or is_circle_owner(circle_id)
  );
drop policy if exists circle_members_delete on circle_members;
create policy circle_members_delete on circle_members for delete
  using (profile_id = auth.uid()::text or is_circle_owner(circle_id));

-- ----------------------------------------------------------------------------
-- "You're invited to <circle>" / "X joined <circle>"
-- ----------------------------------------------------------------------------
create or replace function circle_member_notify() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  circle_name text;
  owner_id    text;
  member_name text;
begin
  if new.profile_id like 'demo-%' then
    return new;
  end if;

  select name, created_by into circle_name, owner_id from circles where id = new.circle_id;

  if tg_op = 'INSERT' and new.status = 'invited' then
    -- Owner-initiated invite (a future direct-by-profile-id path). Tell the
    -- invitee.
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, link)
    values (
      'ntf-cinv-' || substr(md5(new.circle_id || new.profile_id || clock_timestamp()::text), 1, 16),
      new.profile_id,
      'circle_invite',
      'You''re invited to ' || coalesce(circle_name, 'a circle'),
      'Join to see the group''s trip board and pinned cars.',
      '{in_app}',
      now(),
      '/circles/' || new.circle_id
    );
  elsif new.status = 'active' and new.profile_id <> owner_id
    and (tg_op = 'INSERT' or old.status <> 'active') then
    -- Someone is now an active member who wasn't a moment ago, and it isn't
    -- the owner's own seed row from circle creation. Covers both an accepted
    -- owner-invite (UPDATE, old.status = 'invited') and a share-link claim
    -- (INSERT straight to 'active' — migration 063's claim_circle_invite).
    select full_name into member_name from profiles where id = new.profile_id;
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, link)
    values (
      'ntf-cjoin-' || substr(md5(new.circle_id || new.profile_id || clock_timestamp()::text), 1, 16),
      owner_id,
      'circle_invite',
      coalesce(member_name, 'Someone') || ' joined ' || coalesce(circle_name, 'your circle'),
      '',
      '{in_app}',
      now(),
      '/circles/' || new.circle_id
    );
  end if;
  return new;
end $$;

drop trigger if exists circle_member_notify_trigger on circle_members;
create trigger circle_member_notify_trigger after insert or update on circle_members
  for each row execute function circle_member_notify();
