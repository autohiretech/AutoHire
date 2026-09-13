-- 090 — Cash on pickup: a booking whose money never touches a rail.
--
-- The footer has advertised "Cash on pickup" since the marketplace shipped and
-- nothing behind it existed. This is the database half of making that true.
--
-- The shape of the thing: the renter is quoted an ESTIMATE and books without
-- paying. No charge, no hold, no escrow. At the handoff the host takes cash and
-- says how much they actually took, which is not always the estimate — a trip
-- comes back a day late, or early, or with the tank empty. So two numbers are
-- kept and both matter: what was quoted, and what was collected.
--
-- Apply in the Supabase SQL editor or via `supabase db push`. Safe to re-run.

-- ── Which cars take cash ───────────────────────────────────────────────────
-- Off by default. Handling cash is a thing a host does with their hands, and a
-- column that defaults to true would volunteer every host on the platform for
-- it without asking.
alter table listings add column if not exists accepts_cash boolean not null default false;

comment on column listings.accepts_cash is
  'Host accepts cash at pickup for this car. Renters see a Cash option and book '
  'without paying; no hold, no escrow, no payout — see bookings.provider = ''cash''.';

-- Half the fleet, to have something to look at.
--
-- `hashtext(id)` rather than `random()` so a re-run picks the SAME half — a
-- migration that reshuffles which cars take cash every time it runs is a
-- migration nobody can test against. Even hashes win; that is ~50% and it is
-- stable per id. (`% 2 = 0` is sign-safe: an even number is even either way.)
--
-- Guarded on "nobody has said yes yet" rather than on the column's own default,
-- because after this runs `false` stops meaning "undecided" and starts meaning
-- "this host said no" — and a re-run must not overrule them.
do $$
begin
  if not exists (select 1 from listings where accepts_cash) then
    update listings set accepts_cash = true where (hashtext(id) % 2) = 0;
  end if;
end $$;

-- ── A booking that is not a payment ────────────────────────────────────────
do $$
begin
  alter table bookings drop constraint if exists bookings_provider_check;
  alter table bookings add constraint bookings_provider_check
    check (provider is null or provider in
      ('stripe', 'flutterwave', 'demo', 'external', 'payhold', 'cash'));
end $$;

-- What the renter was quoted when they booked, in the car's currency — the
-- same units as subtotal_rwf and friends (see the column note on that name:
-- `_rwf` is historical, the value is in the listing's own currency).
alter table bookings add column if not exists cash_estimate_rwf integer;

-- What the host says they actually took, and when. Null until the handoff.
-- Deliberately separate from `total_rwf`: the quote is what the renter agreed
-- to and must stay readable afterwards, so settlement is recorded ALONGSIDE it
-- rather than overwriting it. A trip where those two differ is exactly the
-- trip anyone would later want to look at.
alter table bookings add column if not exists cash_collected_rwf integer;
alter table bookings add column if not exists cash_collected_at timestamptz;

comment on column bookings.cash_estimate_rwf is
  'Cash bookings: the total quoted at booking time. Never changes.';
comment on column bookings.cash_collected_rwf is
  'Cash bookings: what the host reports collecting at handoff. May differ from '
  'the estimate — late return, early return, fuel. Null until they say.';

-- ── No payout for money we never held ──────────────────────────────────────
-- `release_payout_on_complete` schedules a payout the moment a trip completes,
-- on the assumption that the money is sitting in escrow waiting to be sent. On
-- a cash trip the host was paid in notes at the kerb; scheduling a payout would
-- be AutoHire promising to send them the same money a second time, out of its
-- own pocket, on every cash trip that ever completes.
create or replace function release_payout_on_complete()
returns trigger
language plpgsql
security definer
as $$
declare
  pm text;
  pp text;
  ch payout_channel;
begin
  if new.state = 'completed' and old.state is distinct from 'completed' then
    new.hold_status := 'released';

    -- The host already has the money. Nothing to release, nothing to send.
    if new.provider = 'cash' then
      return new;
    end if;

    if not exists (select 1 from payouts where booking_id = new.id) then
      select payout_method, payout_provider into pm, pp
        from profiles where id = new.host_id;

      ch := case
              when pm in ('bank', 'card') then 'bank_transfer'::payout_channel
              else 'mtn_momo'::payout_channel
            end;

      insert into payouts (id, booking_id, host_id, amount_rwf, channel, status, provider, scheduled_for)
      values ('po-' || new.id, new.id, new.host_id, new.subtotal_rwf, ch, 'scheduled', pp, current_date + 1);
    end if;
  end if;

  return new;
end $$;
