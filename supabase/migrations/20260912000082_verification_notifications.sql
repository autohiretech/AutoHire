-- AutoHire migration 082 — tell people what happened to their verification.
--
-- Approving, rejecting and overriding all wrote an audit row and nothing else,
-- so the person who uploaded a document was never told anything: an admin
-- rejected a blurry ID with a careful reason, and the only place that reason
-- existed was a table the applicant cannot read. They found out by opening the
-- page again on a hunch.
--
-- Two triggers, both writing the `verification` notification kind the bell
-- already renders and routes to /verification:
--   • a document decision — approved, or rejected WITH the admin's reason;
--   • the account's own status — verified, rejected, or verification removed.
--
-- Both fire only when the value actually changed, and the profile one skips
-- 'pending' because "we are looking at it" is not news to someone who just
-- uploaded something.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create or replace function verification_doc_label(p_type verification_doc_type)
  returns text language sql immutable as $$
  select case p_type
           when 'drivers_license'       then 'driver''s licence'
           when 'national_id'           then 'national ID or passport'
           when 'vehicle_registration'  then 'vehicle registration'
           when 'insurance_certificate' then 'proof of insurance'
           when 'business_registration' then 'business registration'
         end
$$;

-- ----------------------------------------------------------------------------
-- 1. One document was decided.
-- ----------------------------------------------------------------------------
create or replace function notify_document_decision()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  lbl text := coalesce(verification_doc_label(new.type), 'document');
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'verified' then
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
    values ('ntf-' || replace(gen_random_uuid()::text, '-', ''), new.profile_id, 'verification',
            'Your ' || lbl || ' was approved',
            'We checked your ' || lbl || ' and approved it.',
            '{in_app}', now(), false, '/verification');
  elsif new.status = 'rejected' then
    -- The reason is the whole point of the message, so it leads. Without one,
    -- say plainly that there isn't one rather than inventing a cause.
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
    values ('ntf-' || replace(gen_random_uuid()::text, '-', ''), new.profile_id, 'verification',
            'Your ' || lbl || ' was not accepted',
            coalesce(nullif(btrim(new.note), ''), 'A reviewer could not accept it.')
              || ' Open verification to upload it again.',
            '{in_app}', now(), false, '/verification');
  end if;
  return new;
end $$;

drop trigger if exists verification_notify on verification_documents;
create trigger verification_notify
  after update on verification_documents
  for each row execute function notify_document_decision();

-- ----------------------------------------------------------------------------
-- 2. The account's own status changed.
-- ----------------------------------------------------------------------------
create or replace function notify_verification_status()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- A document decision changes the account's status a moment later, through
  -- `sync_profile_verification`. The bad news has already been delivered by the
  -- document message, naming the document and the reviewer's reason, so the
  -- account-level version of it would just repeat itself more vaguely. `now()`
  -- is the transaction's clock, so rows written by that same decision match.
  just_told boolean := exists (
    select 1 from notifications n
     where n.profile_id = new.id
       and n.kind = 'verification'
       and n.created_at >= now() - interval '10 seconds'
  );
begin
  if new.verification is not distinct from old.verification then
    return new;
  end if;

  if new.verification = 'verified' then
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
    values ('ntf-' || replace(gen_random_uuid()::text, '-', ''), new.id, 'verification',
            'Your account is verified',
            'Everything we needed checks out. You can book, and list a car, without anything else from us.',
            '{in_app}', now(), false, '/verification');
  elsif new.verification = 'rejected' and not just_told then
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
    values ('ntf-' || replace(gen_random_uuid()::text, '-', ''), new.id, 'verification',
            'Your verification was not approved',
            'Open verification to see which document to replace.',
            '{in_app}', now(), false, '/verification');
  elsif new.verification = 'unverified' and old.verification = 'verified' and not just_told then
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link)
    values ('ntf-' || replace(gen_random_uuid()::text, '-', ''), new.id, 'verification',
            'Your account is no longer verified',
            'Open verification to see what is needed.',
            '{in_app}', now(), false, '/verification');
  end if;
  return new;
end $$;

drop trigger if exists profile_verification_notify on profiles;
create trigger profile_verification_notify
  after update on profiles
  for each row execute function notify_verification_status();
