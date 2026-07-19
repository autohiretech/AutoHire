-- AutoHire migration 031 — KYC documents: real storage + manual review.
--
-- Turns the verification stub into a working KYC system:
--   1. verification_documents gains storage_path + reviewer audit columns.
--   2. A PRIVATE `kyc-documents` bucket holds the actual files. Owners write
--      their own folder; only the owner and admins can read (via signed URLs).
--   3. Hosts no longer read renters' raw documents (privacy) — they rely on the
--      profiles.verification badge, which the counterparty policy already shows.
--   4. Admins can review (update) any document.
--   5. profiles.verification is kept in sync by a trigger that recomputes the
--      overall status from a profile's required documents whenever one changes.
--      This is the controlled path that the profile_guard trigger (migration
--      029) allows verification to change through — users still can't self-verify.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. Columns: where the file lives + who reviewed it.
-- ----------------------------------------------------------------------------
alter table verification_documents
  add column if not exists storage_path text,
  add column if not exists reviewed_by  text references profiles(id) on delete set null,
  add column if not exists reviewed_at  timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Private bucket for the actual ID files.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do update set public = false;

drop policy if exists "kyc owner read"   on storage.objects;
drop policy if exists "kyc admin read"   on storage.objects;
drop policy if exists "kyc owner write"  on storage.objects;
drop policy if exists "kyc owner modify" on storage.objects;
drop policy if exists "kyc owner delete" on storage.objects;

-- Files live under "<owner-uid>/<file>". Owner reads their own; admins read all.
create policy "kyc owner read" on storage.objects for select to authenticated
  using (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kyc admin read" on storage.objects for select to authenticated
  using (bucket_id = 'kyc-documents' and is_admin());
create policy "kyc owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kyc owner modify" on storage.objects for update to authenticated
  using (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kyc owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- 3. Hosts no longer read renters' raw verification documents.
-- ----------------------------------------------------------------------------
drop policy if exists vdocs_host_read on verification_documents;

-- ----------------------------------------------------------------------------
-- 4. Admins may review (update) any document; owner + admin already read via
--    vdocs_read from migration 029/005.
-- ----------------------------------------------------------------------------
drop policy if exists vdocs_admin_update on verification_documents;
create policy vdocs_admin_update on verification_documents for update
  using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 5. Keep profiles.verification in sync with the documents.
-- ----------------------------------------------------------------------------
-- Required documents per role, mirroring web/src/lib/verification.ts.
create or replace function compute_profile_verification(p_profile_id text)
  returns verification_status
  language plpgsql stable security definer set search_path = public as $$
declare
  prole user_role;
  otype owner_type;
  req   verification_doc_type[];
  t     verification_doc_type;
  st    verification_status;
  has_rejected boolean := false;
  has_pending  boolean := false;
begin
  select role, owner_type into prole, otype from profiles where id = p_profile_id;
  if prole is null then
    return 'unverified';
  elsif otype = 'business' then
    req := array['business_registration','national_id','vehicle_registration','insurance_certificate']::verification_doc_type[];
  elsif prole = 'owner' then
    req := array['drivers_license','national_id','vehicle_registration','insurance_certificate']::verification_doc_type[];
  else
    req := array['drivers_license','national_id']::verification_doc_type[];
  end if;

  foreach t in array req loop
    select status into st from verification_documents
      where profile_id = p_profile_id and type = t;
    if st is null or st = 'unverified' then
      return 'unverified';
    elsif st = 'rejected' then
      has_rejected := true;
    elsif st = 'pending' then
      has_pending := true;
    end if;
  end loop;

  if has_rejected then return 'rejected'; end if;
  if has_pending  then return 'pending';  end if;
  return 'verified';
end $$;

-- After any document change, recompute + write the owner's overall status.
-- Sets a transaction-local flag so profile_guard permits this internal update.
create or replace function sync_profile_verification()
  returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  pid text := coalesce(new.profile_id, old.profile_id);
  v   verification_status;
begin
  v := compute_profile_verification(pid);
  perform set_config('app.verification_sync', 'on', true);
  update profiles set verification = v where id = pid;
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;

drop trigger if exists verification_sync on verification_documents;
create trigger verification_sync
  after insert or update or delete on verification_documents
  for each row execute function sync_profile_verification();

-- Let the sync trigger's controlled update through profile_guard.
create or replace function profile_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or is_admin()
     or coalesce(current_setting('app.verification_sync', true), '') = 'on' then
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
