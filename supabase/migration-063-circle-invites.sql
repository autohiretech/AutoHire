-- AutoHire migration 063 — circle invites, share-link only.
--
-- Scope cut, deliberate: the social-layer plan describes TWO invite paths.
-- (A) a share link anyone can open, and (B) matching a phone/email against a
-- brand-new signup so an inviter gets told "Sarah joined — you invited her"
-- even though Sarah had no account yet. This migration ships (A) only.
--
-- (B) needs `profiles.phone` to be unique, and it isn't today — there's no
-- unique index on it, so matching an invite to "the" account with that phone
-- number could resolve to the wrong one, or to two. That needs a backfill
-- through the existing `normalizePhone()` helper (web/src/lib/phone.ts)
-- checked against production data before a unique index goes on an existing,
-- populated column. That's real work on a table nothing else here touches,
-- so it's its own migration, later, not bundled in on the promise that
-- production data will turn out to be clean.
--
-- What ships now covers the common case without any of that risk: create a
-- circle, generate a link, send it via WhatsApp/SMS/anything — the token IS
-- the credential, so whoever holds the link and is signed in can claim it.
-- If they don't have an account yet, they sign up first and then open the
-- link again; nothing here auto-detects them mid-signup.
--
-- Apply after migration 062. Safe to re-run.

create table if not exists circle_invites (
  id         text primary key,
  circle_id  text not null references circles(id) on delete cascade,
  invited_by text not null references profiles(id) on delete cascade,
  token      text not null unique,
  claimed_by text references profiles(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists circle_invites_circle_idx on circle_invites (circle_id);

alter table circle_invites enable row level security;

-- Read: the inviter (to see who's claimed it) or a circle owner. NOT open to
-- everyone — the token itself is the credential for claiming, but the row
-- (who invited whom, when) is the circle's business, not the public's.
drop policy if exists circle_invites_read on circle_invites;
create policy circle_invites_read on circle_invites for select using (
  invited_by = auth.uid()::text
  or is_circle_owner(circle_id)
  or is_admin()
);
drop policy if exists circle_invites_insert on circle_invites;
create policy circle_invites_insert on circle_invites for insert
  with check (invited_by = auth.uid()::text and is_circle_member(circle_id));
drop policy if exists circle_invites_delete on circle_invites;
create policy circle_invites_delete on circle_invites for delete
  using (invited_by = auth.uid()::text or is_circle_owner(circle_id));

-- Claiming goes through a function rather than a client-side insert into
-- circle_members: it has to do two things atomically (mark the invite
-- claimed, add the membership) and the token lookup itself must bypass RLS —
-- a not-yet-a-member has no way to SELECT a circle_invites row to find its
-- circle_id, by design (see circle_invites_read above).
create or replace function claim_circle_invite(p_token text)
  returns text -- the circle_id joined, or null if the token was invalid/used
  language plpgsql security definer set search_path = public as $$
declare
  v_circle_id text;
  v_claimed_by text;
begin
  select circle_id, claimed_by into v_circle_id, v_claimed_by
    from circle_invites where token = p_token;

  if v_circle_id is null then
    return null; -- unknown token
  end if;
  if v_claimed_by is not null then
    return null; -- already used — a link is single-use, not single-viewer
  end if;

  update circle_invites set claimed_by = auth.uid()::text, claimed_at = now()
    where token = p_token;

  insert into circle_members (circle_id, profile_id, role, status)
    values (v_circle_id, auth.uid()::text, 'member', 'active')
    on conflict (circle_id, profile_id) do update set status = 'active';

  return v_circle_id;
end $$;

grant execute on function claim_circle_invite(text) to authenticated;
