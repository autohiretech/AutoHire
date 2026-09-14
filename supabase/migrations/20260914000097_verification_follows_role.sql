-- A verified renter who becomes a host is not a verified host.
--
-- `compute_profile_verification` has always known that the required documents
-- depend on the role: a renter owes a licence and an ID, a personal host owes
-- those plus the vehicle's registration and insurance, a business host swaps
-- the licence for a business registration. But the only thing that ever re-ran
-- it was a change to a *document* (`verification_sync` on
-- verification_documents). Changing the ROLE changes the required set just as
-- surely, and nothing recomputed.
--
-- So a renter who had uploaded a licence and an ID, been reviewed, and been
-- marked verified kept the word "Verified" on their account the moment they
-- became a host — while owing two documents nobody had ever looked at. Every
-- renter browsing their car saw a verified host. The account was answering a
-- question it had never been asked.
--
-- `VerificationPage` already compensates for the account holder's own view
-- (`effectiveVerificationStatus` takes the worse of the stored status and the
-- current role's documents). That fixes what *they* see and nothing else:
-- host cards, booking requests and the admin queues all read the stored
-- column. This makes the column itself correct, which is the only version of
-- the fix that reaches everyone.
--
-- Both directions, deliberately. Switching back to renting recomputes too:
-- someone whose licence and ID are verified gets "verified" back rather than
-- staying stuck at the status their missing vehicle papers earned them.
-- `compute_profile_verification` is the single definition of what each role
-- owes, so neither direction needs its own rules here.
--
-- An explicit admin decision (`verification_override`) still wins, exactly as
-- it does for a document change — same check, same reason.

create or replace function sync_verification_on_role_change()
  returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  ovr boolean := coalesce(new.verification_override, false);
  v   verification_status;
begin
  if ovr then
    return null;                       -- a person decided; leave it alone
  end if;
  v := compute_profile_verification(new.id);
  if v is distinct from new.verification then
    -- The same transaction-local flag `sync_profile_verification` uses, so
    -- profile_guard lets this write through while still refusing the account
    -- holder's own attempt to set their verification.
    perform set_config('app.verification_sync', 'on', true);
    update profiles set verification = v where id = new.id;
    perform set_config('app.verification_sync', 'off', true);
  end if;
  return null;
end $$;

drop trigger if exists verification_follows_role on profiles;
create trigger verification_follows_role
  after update of role, owner_type on profiles
  for each row
  when (new.role is distinct from old.role or new.owner_type is distinct from old.owner_type)
  execute function sync_verification_on_role_change();

comment on function sync_verification_on_role_change() is
  'Recomputes profiles.verification when the role changes the set of documents required.';
