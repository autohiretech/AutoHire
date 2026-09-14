-- Does an account exist with this email / phone? Asked by the sign-up form.
--
-- `check-account-availability` was asking `public.profiles`, and that is not
-- where the answer lives. A profile row is written by `ensureProfile` on the
-- first authenticated page load — so an account that has signed up but not yet
-- loaded the app has no row, and any account whose row predates the column
-- being populated has a blank one. The live check reported "free" for an
-- address that was signed in to the admin site at that moment, which is how
-- this was found.
--
-- `auth.users` is the authority: a row exists there from the instant the
-- account is created, and Supabase Auth already enforces email uniqueness on
-- it. PostgREST only exposes the `public` schema, so reaching it needs these
-- two SECURITY DEFINER functions.
--
-- **Who may call them is the whole security design.** EXECUTE is revoked from
-- `anon` and `authenticated` and granted only to `service_role`. Without that
-- revoke these would be a public RPC — an unauthenticated enumeration oracle
-- with no rate limit, reachable straight from the browser with the anon key
-- that ships in the bundle. Behind the revoke, the only way to ask is through
-- the Edge Function, which is rate-limited per IP and answers one boolean.
--
-- They return a boolean and nothing else. No id, no name, no timestamp:
-- nothing that turns a hit into a person.

create or replace function public.account_exists_for_email(p_email text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
      and deleted_at is null
  );
$$;

-- Phone lives in two places and both count. Supabase Auth only fills
-- `auth.users.phone` when a number has been through SMS verification, while
-- `profiles.phone` is what sign-up writes and what the app shows — so an
-- unverified number exists only in profiles, and a verified one may have been
-- changed in auth without profiles catching up. Either is "already in use".
create or replace function public.account_exists_for_phone(p_phone text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where phone = trim(p_phone) and deleted_at is null
  ) or exists (
    select 1 from public.profiles
    where phone = trim(p_phone) and phone <> ''
  );
$$;

revoke all on function public.account_exists_for_email(text) from public;
revoke all on function public.account_exists_for_email(text) from anon;
revoke all on function public.account_exists_for_email(text) from authenticated;
grant execute on function public.account_exists_for_email(text) to service_role;

revoke all on function public.account_exists_for_phone(text) from public;
revoke all on function public.account_exists_for_phone(text) from anon;
revoke all on function public.account_exists_for_phone(text) from authenticated;
grant execute on function public.account_exists_for_phone(text) to service_role;

comment on function public.account_exists_for_email(text) is
  'Sign-up availability check. service_role only — see migration 096.';
comment on function public.account_exists_for_phone(text) is
  'Sign-up availability check, across auth.users and profiles. service_role only.';
