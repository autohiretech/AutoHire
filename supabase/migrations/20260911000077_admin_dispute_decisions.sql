-- AutoHire — migration 077: disputes are decided in AutoHire's admin.
--
-- Until now a PayHold case could only be decided by a person in PayHold's
-- dashboard, and AutoHire learned the outcome by webhook — or, since nothing
-- handled `dispute.resolved`, did not learn it at all. The decision moves here:
-- an AutoHire admin decides in Admin → Disputes, `payhold-dispute` records that
-- decision on this row, and then relays the STORED decision to PayHold, which
-- moves the money (`POST /v1/disputes/:id/resolve`, gated on PayHold's
-- `dispute_decision_relay` tenant setting).
--
-- Store first, relay what is stored: a retry after a timeout or a "setting is
-- off" answer relays exactly the decision that was made, never a second one
-- typed later, so the money cannot move twice or differently.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- A split is its own outcome
-- ---------------------------------------------------------------------------
--
-- PayHold resolves a case three ways: released to the host, refunded to the
-- renter, or split. `resolved_renter` / `resolved_host` cannot say "split", and
-- mapping a partial refund onto either would tell one party they won outright.

alter type dispute_status add value if not exists 'resolved_split';

-- ---------------------------------------------------------------------------
-- The decision and PayHold's mirror of it
-- ---------------------------------------------------------------------------

alter table disputes add column if not exists payhold_status        text;
alter table disputes add column if not exists resolution            text;
alter table disputes add column if not exists refund_amount_minor   bigint;
alter table disputes add column if not exists currency              text;
alter table disputes add column if not exists disputed_amount_minor bigint;
alter table disputes add column if not exists resolution_note       text;
alter table disputes add column if not exists decided_by            text;
alter table disputes add column if not exists resolved_at           timestamptz;
alter table disputes add column if not exists reason_code           text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'disputes_resolution_check') then
    alter table disputes add constraint disputes_resolution_check
      check (resolution is null or resolution in ('release', 'refund', 'partial_refund'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'disputes_refund_amount_minor_check') then
    alter table disputes add constraint disputes_refund_amount_minor_check
      check (refund_amount_minor is null or refund_amount_minor > 0);
  end if;
end $$;

comment on column disputes.payhold_status is
  'PayHold''s own status for the case: open | resolved_released | resolved_refunded | resolved_split.';
comment on column disputes.resolution is
  'The admin''s decision: release | refund | partial_refund. Recorded before it is relayed; null until decided.';
comment on column disputes.refund_amount_minor is
  'partial_refund only — minor units of `currency` (the PayHold deal currency).';
comment on column disputes.currency is
  'The PayHold deal currency every *_minor column on this row is denominated in.';
comment on column disputes.disputed_amount_minor is
  'What the raiser disputed, minor units of `currency`. Null means the whole deal.';
comment on column disputes.decided_by is
  'Who decided: autohire-admin:<email> for a decision made here, PayHold''s actor otherwise.';
comment on column disputes.resolved_at is
  'When PayHold executed the decision. Null while a recorded decision is still waiting to be relayed.';

-- ---------------------------------------------------------------------------
-- Only the service role writes a decision
-- ---------------------------------------------------------------------------
--
-- RLS is unchanged: a party may still insert their own dispute and admins may
-- still update. But `payhold-dispute` relays what these columns SAY, so a row a
-- renter inserted with `resolution = 'refund'` already filled in would be a
-- decision an admin's "retry" could send to PayHold under a name nobody typed.
-- The decision columns are therefore written by Edge Functions (service role,
-- `auth.uid()` null) and nobody else — not a party, and not an admin's browser
-- either, because `decided_by` must come from a server-side session.

create or replace function disputes_guard_decision() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.payhold_status is not null
      or new.resolution is not null
      or new.refund_amount_minor is not null
      or new.resolution_note is not null
      or new.decided_by is not null
      or new.resolved_at is not null then
      raise exception 'A dispute decision is recorded by payhold-dispute, not written directly.'
        using errcode = '42501';
    end if;
  elsif new.payhold_status is distinct from old.payhold_status
    or new.resolution is distinct from old.resolution
    or new.refund_amount_minor is distinct from old.refund_amount_minor
    or new.resolution_note is distinct from old.resolution_note
    or new.decided_by is distinct from old.decided_by
    or new.resolved_at is distinct from old.resolved_at then
    raise exception 'A dispute decision is recorded by payhold-dispute, not written directly.'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists disputes_guard_decision on disputes;
create trigger disputes_guard_decision
  before insert or update on disputes
  for each row execute function disputes_guard_decision();
