-- AutoHire migration 029 — security hardening.
--
-- 1. profiles guard trigger — closes the privilege-escalation hole where any
--    signed-in user could UPDATE their own row to role='admin', fake the
--    'verified' badge, or edit their own rating. renter <-> owner stays
--    self-service ("become a host"); everything else is platform-managed.
-- 2. Drops the DEMO-ONLY bookings_insert_demo policy (migration 006), so the
--    confirm-booking Edge Function is once again the only way to create a
--    booking (it recomputes the price server-side).
-- 3. Stops email / phone being world-readable. Full profile rows are now
--    visible only to yourself, admins, and your booking / conversation
--    counterparties. Everyone else (including signed-out browsing) reads the
--    new `public_profiles` view, which exposes only safe columns.
-- 4. Makes the chat-files bucket private: attachments are readable only by the
--    uploader and their conversation counterparties, via signed URLs.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. Guard platform-managed profile columns.
-- ----------------------------------------------------------------------------
-- The service role and the SQL editor (no signed-in user → auth.uid() is null)
-- are exempt, as are admins; everyone else is restricted.

create or replace function profile_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'admin' then
      raise exception 'You cannot create an admin account.';
    end if;
    if new.verification <> 'unverified'
       or new.rating_avg is not null
       or new.rating_count is not null then
      raise exception 'Verification and rating are managed by the platform.';
    end if;
    return new;
  end if;

  -- UPDATE: renter <-> owner is allowed; to or from 'admin' is not.
  if new.role is distinct from old.role
     and (new.role = 'admin' or old.role = 'admin') then
    raise exception 'That role change is not allowed.';
  end if;
  if new.verification is distinct from old.verification
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count then
    raise exception 'Verification and rating are managed by the platform.';
  end if;
  return new;
end $$;

drop trigger if exists profile_guard_trigger on profiles;
create trigger profile_guard_trigger
  before insert or update on profiles
  for each row execute function profile_guard();

-- ----------------------------------------------------------------------------
-- 2. Bookings come only from the confirm-booking Edge Function again.
-- ----------------------------------------------------------------------------

drop policy if exists bookings_insert_demo on bookings;

-- ----------------------------------------------------------------------------
-- 3. Profile PII (email / phone) is no longer world-readable.
-- ----------------------------------------------------------------------------
-- Full rows: self, admins, and booking / conversation counterparties (a host
-- reviewing a requester, chat threads). Public browsing uses the view below.

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (
  id = auth.uid()::text
  or is_admin()
  or exists (
    select 1 from bookings b
    where (b.renter_id = auth.uid()::text and b.host_id = profiles.id)
       or (b.host_id = auth.uid()::text and b.renter_id = profiles.id)
  )
  or exists (
    select 1 from conversations c
    where (c.renter_id = auth.uid()::text and c.host_id = profiles.id)
       or (c.host_id = auth.uid()::text and c.renter_id = profiles.id)
  )
);

-- PII-free public projection for host pages / cards / search. Deliberately a
-- SECURITY DEFINER view (bypasses profiles RLS) — it exposes only safe columns.
drop view if exists public_profiles;
create view public_profiles with (security_invoker = off) as
  select id, full_name, avatar_url, role, joined_at, verification,
         rating_avg, rating_count, owner_type, business_name,
         payout_terms, insurance_type, vehicle_count
  from profiles;

grant select on public_profiles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Chat attachments are private to the conversation.
-- ----------------------------------------------------------------------------
-- The bucket stops being public; reads require being the uploader or sharing a
-- conversation with them (files live under "<uploader-uid>/<file>"). The app
-- renders them through short-lived signed URLs.

update storage.buckets set public = false where id = 'chat-files';

drop policy if exists "chat-files read" on storage.objects;
create policy "chat-files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-files'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from conversations c
        where (c.renter_id = auth.uid()::text and c.host_id = (storage.foldername(name))[1])
           or (c.host_id = auth.uid()::text and c.renter_id = (storage.foldername(name))[1])
      )
    )
  );
