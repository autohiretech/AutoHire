-- One account per email, one per phone number.
--
-- `profiles.email` and `profiles.phone` have carried no unique constraint, so
-- nothing at the database level stopped two accounts sharing either. The
-- sign-up form now checks both while they are typed, but a check in the client
-- is advice, not enforcement: two people can pass it in the same second and
-- both insert. This is the enforcement.
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
-- If duplicates already exist this migration STOPS, names how many, and
-- changes nothing. Deduplicating accounts is a decision about whose data is
-- kept — a person's call, never a migration's side effect.

do $$
declare
  dup_emails bigint;
  dup_phones bigint;
begin
  select count(*) into dup_emails from (
    select lower(email) from public.profiles
    where email <> '' group by lower(email) having count(*) > 1
  ) d;

  select count(*) into dup_phones from (
    select phone from public.profiles
    where phone <> '' group by phone having count(*) > 1
  ) d;

  if dup_emails > 0 or dup_phones > 0 then
    raise exception
      'Cannot enforce unique contacts yet: % duplicated email(s) and % duplicated phone number(s) already exist in profiles. Resolve those rows first — this migration has changed nothing.',
      dup_emails, dup_phones;
  end if;
end $$;

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email))
  where email <> '';

create unique index if not exists profiles_phone_unique
  on public.profiles (phone)
  where phone <> '';

comment on index public.profiles_email_unique is
  'One account per mailbox, case-insensitive. Blank emails are exempt.';
comment on index public.profiles_phone_unique is
  'One account per phone number. Blank phones are exempt.';
