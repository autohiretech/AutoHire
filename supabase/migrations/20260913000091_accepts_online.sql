-- 091 — Let a host run a car cash-only.
--
-- `accepts_cash` (migration 090) only ever added an option next to the
-- platform's online rail; there was no way to turn the rail itself off for a
-- specific car. A host who genuinely only wants cash still had "Pay online"
-- shown as the lead option on their own listing, unable to opt out of it.
--
-- Apply in the Supabase SQL editor or via `supabase db push`. Safe to re-run.

-- On by default: online payment is the platform's own rail, not something a
-- host has to opt into. Every existing listing keeps taking it, unchanged.
alter table listings add column if not exists accepts_online boolean not null default true;

comment on column listings.accepts_online is
  'Host accepts card/mobile-money/wallet payment for this car. Off only when '
  'the host has turned it off in favour of accepts_cash — the two must never '
  'both be false, or the car has no way to be booked.';

-- A car with neither method accepted can never be booked, so the same
-- constraint that would let a host misconfigure both off is refused here
-- rather than left to the UI alone to prevent.
alter table listings drop constraint if exists listings_payment_method_check;
alter table listings add constraint listings_payment_method_check
  check (accepts_cash or accepts_online);
