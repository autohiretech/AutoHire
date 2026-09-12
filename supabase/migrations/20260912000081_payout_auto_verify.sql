-- AutoHire migration 081 — verify a host's payout account along with the host.
--
-- Being verified and being payable are two separate checks: PayHold will not
-- pay a destination nobody has verified, and that second decision sits in its
-- own card in the review. It is easy to forget, and a verified host then waits
-- on a check nobody remembers to make.
--
-- `payout_auto_verify` (on by default) lets the admin's decision about a person
-- carry to their payout account. AutoHire still asks PayHold to do it —
-- `payhold-verify-destination`, the same call the button makes — so the two
-- systems can never disagree about an account. PayHold's own security hold on a
-- new or changed account is untouched; it still runs out on its own.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table app_settings
  add column if not exists payout_auto_verify boolean not null default true;

comment on column app_settings.payout_auto_verify is
  'When an admin verifies a host, AutoHire also verifies that host''s PayHold payout destination. Off = each account is verified by hand in Admin -> Verification.';

create or replace function admin_set_payout_auto_verify(p_on boolean) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update app_settings set payout_auto_verify = p_on where id = 1;
  return p_on;
end $$;

revoke all on function admin_set_payout_auto_verify(boolean) from anon;
grant execute on function admin_set_payout_auto_verify(boolean) to authenticated;
