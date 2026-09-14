-- One account per email, one per phone number — as far as the existing data
-- allows today.
--
-- `profiles.email` and `profiles.phone` have carried no unique constraint, so
-- nothing at the database level stopped two accounts sharing either. The
-- sign-up form now checks both while they are typed, but a check in the client
-- is advice, not enforcement: two people can pass it in the same second and
-- both insert.
--
-- Two details that matter more than they look:
--
-- * **Partial, not plain.** Both columns are `not null` and default to the
--   empty string, and a plain unique index would make the SECOND account with
--   no phone number fail to be created. `where <> ''` leaves blanks alone,
--   which is what "unknown" should mean.
-- * **Email is compared case-insensitively.** `Jean@x.com` and `jean@x.com`
--   are the same mailbox everywhere it matters, and the sign-up check
--   lowercases before asking, so the index has to agree or the check and the
--   constraint would disagree about what a duplicate is.
--
-- **The phone index is conditional, and deliberately does not fail the push.**
-- The first attempt at this migration refused outright because three phone
-- numbers are already shared between accounts. That was the right instinct —
-- deciding which row keeps a number is a person's call, never a migration's
-- side effect — but refusing also blocked the email constraint, which has no
-- duplicates at all, and blocked migration 096 behind it. So each index is now
-- considered on its own: whichever can be enforced is enforced now, and
-- whichever cannot says so loudly and leaves every row untouched. Re-running
-- this migration after the duplicates are resolved creates the missing index.

do $$
declare
  dup_emails bigint;
  dup_phones bigint;
begin
  select count(*) into dup_emails from (
    select lower(email) from public.profiles
    where email <> '' group by lower(email) having count(*) > 1
  ) d;

  if dup_emails = 0 then
    create unique index if not exists profiles_email_unique
      on public.profiles (lower(email))
      where email <> '';
  else
    raise warning
      'profiles_email_unique NOT created: % email address(es) are shared by more than one account. No rows were changed.',
      dup_emails;
  end if;

  select count(*) into dup_phones from (
    select phone from public.profiles
    where phone <> '' group by phone having count(*) > 1
  ) d;

  if dup_phones = 0 then
    create unique index if not exists profiles_phone_unique
      on public.profiles (phone)
      where phone <> '';
  else
    raise warning
      'profiles_phone_unique NOT created: % phone number(s) are shared by more than one account. No rows were changed. Resolve those accounts, then re-run this migration.',
      dup_phones;
  end if;
end $$;
