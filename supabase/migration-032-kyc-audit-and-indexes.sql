-- AutoHire migration 032 — KYC audit trail + scalability indexes.
--
-- 1. verification_events: an append-only log of every KYC action (submit,
--    resubmit, approve, reject), written automatically by a trigger so the
--    admin panel can show a full activity history — including past decisions
--    that no longer appear in the pending queue. Survives document deletion.
-- 2. Indexes on the columns the admin panel filters / paginates by, so the
--    queues stay fast as data grows.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. KYC activity log.
-- ----------------------------------------------------------------------------
create table if not exists verification_events (
  id          bigint generated always as identity primary key,
  document_id text not null,
  profile_id  text not null,
  doc_type    verification_doc_type not null,
  event       text not null,               -- submitted | resubmitted | approved | rejected
  status      verification_status not null,
  actor_id    text,                        -- who caused it (owner on submit, admin on decision)
  note        text,
  created_at  timestamptz not null default now()
);

alter table verification_events enable row level security;

-- Owners see their own history; admins see everything. Writes happen only from
-- the SECURITY DEFINER trigger below (no insert policy needed).
drop policy if exists vevents_read on verification_events;
create policy vevents_read on verification_events for select
  using (profile_id = auth.uid()::text or is_admin());

-- Append an event whenever a document is created or its status/file changes.
create or replace function log_verification_event()
  returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  ev text;
  actor text;
begin
  if tg_op = 'INSERT' then
    insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
      values (new.id, new.profile_id, new.type, 'submitted', new.status, new.profile_id, new.note);
    return new;
  end if;

  if new.status is distinct from old.status then
    ev := case new.status
            when 'verified' then 'approved'
            when 'rejected' then 'rejected'
            when 'pending'  then 'resubmitted'
            else 'updated'
          end;
    -- A decision is attributed to the reviewing admin; a resubmit to the owner.
    actor := case when new.status in ('verified','rejected')
                  then coalesce(new.reviewed_by, auth.uid()::text)
                  else new.profile_id end;
    insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
      values (new.id, new.profile_id, new.type, ev, new.status, actor, new.note);
  elsif new.storage_path is distinct from old.storage_path then
    insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
      values (new.id, new.profile_id, new.type, 'resubmitted', new.status, new.profile_id, new.note);
  end if;
  return new;
end $$;

drop trigger if exists verification_audit on verification_documents;
create trigger verification_audit
  after insert or update on verification_documents
  for each row execute function log_verification_event();

-- ----------------------------------------------------------------------------
-- 2. Indexes for the admin queues (filter + paginate + order).
-- ----------------------------------------------------------------------------
create index if not exists verification_documents_status_idx     on verification_documents (status);
create index if not exists verification_documents_profile_id_idx on verification_documents (profile_id);
create index if not exists verification_events_created_at_idx    on verification_events (created_at desc);
create index if not exists verification_events_profile_id_idx    on verification_events (profile_id, created_at desc);
create index if not exists verification_events_event_idx         on verification_events (event);
create index if not exists flags_status_idx                      on flags (status);
create index if not exists disputes_status_idx                   on disputes (status);
create index if not exists bookings_state_idx                    on bookings (state);
create index if not exists bookings_listing_id_idx               on bookings (listing_id);
create index if not exists listings_host_id_idx                  on listings (host_id);
create index if not exists profiles_role_idx                     on profiles (role);
