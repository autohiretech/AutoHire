-- AutoHire migration 033 — grouped KYC review + admin override + event backfill.
--
--   1. verification_events allows profile-level entries (document_id/doc_type
--      nullable) so an admin override can be logged without a specific doc.
--   2. profiles.verification_override makes an admin decision sticky — the sync
--      trigger stops auto-recomputing once an admin has overridden a user.
--   3. Admin RPCs: a grouped review queue (one row per person, with counts),
--      set-override, and clear-override.
--   4. Backfill events for the documents that predate the audit log, so the
--      activity feed reflects existing data.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. Profile-level events allowed.
-- ----------------------------------------------------------------------------
alter table verification_events alter column document_id drop not null;
alter table verification_events alter column doc_type    drop not null;

-- ----------------------------------------------------------------------------
-- 2. Sticky admin override.
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists verification_override boolean not null default false;

-- Sync trigger: skip auto-recompute when an admin override is in force.
create or replace function sync_profile_verification()
  returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  pid text := coalesce(new.profile_id, old.profile_id);
  ovr boolean;
  v   verification_status;
begin
  select verification_override into ovr from profiles where id = pid;
  if coalesce(ovr, false) then
    return null;                       -- admin decision wins; leave it alone
  end if;
  v := compute_profile_verification(pid);
  perform set_config('app.verification_sync', 'on', true);
  update profiles set verification = v where id = pid;
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;

-- Guard the override flag the same way as verification itself.
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
     or new.verification_override is distinct from old.verification_override
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count then
    raise exception 'Verification and rating are managed by the platform.';
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Admin RPCs.
-- ----------------------------------------------------------------------------
-- Grouped review queue: one row per person who has documents, with counts and
-- a window total for pagination. p_scope 'pending' = only people with a
-- document awaiting review; anything else = everyone who has uploaded.
create or replace function admin_kyc_profiles(
  p_scope  text default 'pending',
  p_search text default '',
  p_limit  int  default 20,
  p_offset int  default 0
)
returns table (
  id text, full_name text, email text, avatar_url text,
  role user_role, owner_type owner_type,
  verification verification_status, verification_override boolean,
  pending_count bigint, doc_count bigint, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  with agg as (
    select vd.profile_id,
           count(*) as doc_count,
           count(*) filter (where vd.status = 'pending') as pending_count
    from verification_documents vd
    group by vd.profile_id
  )
  select p.id, p.full_name, p.email, p.avatar_url, p.role, p.owner_type,
         p.verification, p.verification_override,
         a.pending_count, a.doc_count,
         count(*) over() as total_count
  from agg a
  join profiles p on p.id = a.profile_id
  where (p_scope <> 'pending' or a.pending_count > 0)
    and (p_search = ''
         or p.full_name ilike '%' || p_search || '%'
         or p.email     ilike '%' || p_search || '%')
  order by a.pending_count desc, p.full_name
  limit p_limit offset p_offset;
end $$;

-- Directly set a user's verification (sticky override) and log it.
create or replace function admin_set_verification(
  p_profile_id text,
  p_status     verification_status,
  p_note       text default null
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  perform set_config('app.verification_sync', 'on', true);
  update profiles set verification = p_status, verification_override = true
    where id = p_profile_id;
  perform set_config('app.verification_sync', 'off', true);
  insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
    values (null, p_profile_id, null, 'override', p_status, auth.uid()::text, p_note);
end $$;

-- Drop the override and resume automatic status from the documents.
create or replace function admin_clear_verification_override(p_profile_id text)
  returns verification_status
  language plpgsql security definer set search_path = public as $$
declare v verification_status;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  v := compute_profile_verification(p_profile_id);
  perform set_config('app.verification_sync', 'on', true);
  update profiles set verification = v, verification_override = false
    where id = p_profile_id;
  perform set_config('app.verification_sync', 'off', true);
  insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
    values (null, p_profile_id, null, 'updated', v, auth.uid()::text, 'Override cleared');
  return v;
end $$;

revoke all on function admin_kyc_profiles(text, text, int, int) from anon;
revoke all on function admin_set_verification(text, verification_status, text) from anon;
revoke all on function admin_clear_verification_override(text) from anon;
grant execute on function admin_kyc_profiles(text, text, int, int) to authenticated;
grant execute on function admin_set_verification(text, verification_status, text) to authenticated;
grant execute on function admin_clear_verification_override(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Backfill activity for documents that predate the audit log.
-- ----------------------------------------------------------------------------
insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note, created_at)
select vd.id, vd.profile_id, vd.type, 'submitted', 'pending', vd.profile_id, null,
       coalesce(vd.uploaded_at::timestamptz, now())
from verification_documents vd
where not exists (
  select 1 from verification_events e
  where e.document_id = vd.id and e.event = 'submitted'
);

insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note, created_at)
select vd.id, vd.profile_id, vd.type,
       case vd.status when 'verified' then 'approved' else 'rejected' end,
       vd.status, vd.reviewed_by, vd.note,
       coalesce(vd.reviewed_at, vd.uploaded_at::timestamptz, now()) + interval '1 second'
from verification_documents vd
where vd.status in ('verified', 'rejected')
  and not exists (
    select 1 from verification_events e
    where e.document_id = vd.id and e.event in ('approved', 'rejected')
  );
