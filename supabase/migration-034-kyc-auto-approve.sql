-- AutoHire migration 034 — KYC auto-approve toggle + status enforcement.
--
-- Fixes a real hole AND adds the admin-controlled auto-approve mode:
--
--   * Hole: verification_documents' user-write policy never restricted `status`,
--     so a user could POST a row with status='verified' and self-verify. Now the
--     SERVER decides the status of any user-submitted document via a BEFORE
--     trigger — the client's value is ignored.
--   * Auto-approve: an admin can flip a platform setting so new submissions are
--     verified instantly instead of waiting for manual review. Manual review is
--     the default. The setting only affects NEW submissions, not the existing
--     queue.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- ----------------------------------------------------------------------------
-- Platform settings (single row).
-- ----------------------------------------------------------------------------
create table if not exists app_settings (
  id               int primary key default 1,
  kyc_auto_approve boolean not null default false,
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;
drop policy if exists app_settings_read on app_settings;
-- The toggle state isn't sensitive; any signed-in user may read it. Writes go
-- only through the admin RPC below (no update policy = no direct writes).
create policy app_settings_read on app_settings for select using (true);

create or replace function kyc_auto_approve() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select kyc_auto_approve from app_settings where id = 1), false);
$$;

create or replace function admin_set_kyc_auto_approve(p_on boolean) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update app_settings set kyc_auto_approve = p_on where id = 1;
  return p_on;
end $$;

revoke all on function admin_set_kyc_auto_approve(boolean) from anon;
grant execute on function admin_set_kyc_auto_approve(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Server decides a user-submitted document's status.
-- ----------------------------------------------------------------------------
create or replace function enforce_document_status() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Service role (edge functions) and admins (review actions) set status freely.
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  -- A user submitting / re-uploading their own document: the server sets the
  -- status. Auto-approve verifies immediately; otherwise it awaits review. The
  -- client's status / reviewer fields are never trusted.
  if kyc_auto_approve() then
    new.status := 'verified';
    new.reviewed_by := null;      -- auto-approved by the platform, no human
    new.reviewed_at := now();
    new.note := null;
  else
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists enforce_document_status_trigger on verification_documents;
create trigger enforce_document_status_trigger
  before insert or update on verification_documents
  for each row execute function enforce_document_status();

-- ----------------------------------------------------------------------------
-- Audit log reflects the real outcome (so auto-approvals read as "Approved").
-- ----------------------------------------------------------------------------
create or replace function log_verification_event()
  returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  ev text;
  actor text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'verified' then
      insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
        values (new.id, new.profile_id, new.type, 'approved', 'verified',
                new.reviewed_by, coalesce(new.note, 'Auto-approved'));
    elsif new.status = 'rejected' then
      insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
        values (new.id, new.profile_id, new.type, 'rejected', 'rejected', new.reviewed_by, new.note);
    else
      insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
        values (new.id, new.profile_id, new.type, 'submitted', new.status, new.profile_id, new.note);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    ev := case new.status
            when 'verified' then 'approved'
            when 'rejected' then 'rejected'
            when 'pending'  then 'resubmitted'
            else 'updated'
          end;
    if new.status = 'verified' and new.reviewed_by is null then
      -- auto-approved by the platform (no human reviewer)
      insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
        values (new.id, new.profile_id, new.type, ev, new.status, null, 'Auto-approved');
    else
      actor := case when new.status in ('verified','rejected')
                    then coalesce(new.reviewed_by, auth.uid()::text)
                    else new.profile_id end;
      insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
        values (new.id, new.profile_id, new.type, ev, new.status, actor, new.note);
    end if;
  elsif new.storage_path is distinct from old.storage_path then
    insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
      values (new.id, new.profile_id, new.type, 'resubmitted', new.status, new.profile_id, new.note);
  end if;
  return new;
end $$;
