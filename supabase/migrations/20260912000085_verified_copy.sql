-- AutoHire migration 085 — the verified message stops implying it unlocks
-- renting.
--
-- 082 told a newly verified person "You can book, and list a car, without
-- anything else from us." Renting no longer depends on verification at all —
-- the renter gate is being removed from every place that enforced it — so
-- that sentence credited verification with something it doesn't control, and
-- would have read as a change in what they're allowed to do when nothing
-- about their renting had changed.
--
-- Only the wording changes. The trigger, its guard and the rejected-side
-- copy are exactly as 082 left them.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

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
            'Everything we needed checks out, so nothing more is needed from you. If you host, you can list a car.',
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
