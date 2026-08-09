-- AutoHire — migration 048: PayHold disputes and refunds.
--
-- 047 added the join columns. This adds what the two new write paths need:
-- `payhold-dispute` (a case raised in AutoHire is pushed to PayHold, which is
-- what freezes the payout) and `payhold-refund` (money sent back, in full or
-- in part).
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Partial refunds are now a state a booking can be in
-- ---------------------------------------------------------------------------
--
-- `payhold-refund` can send back some of a trip's money — a damaged-return
-- settlement, a late-cancellation fee — and PayHold reports that deal as
-- `partially_refunded`, not `refunded`. Before this, the webhook had only two
-- words for it and had to pick 'refunded', which cancels the trip: a renter
-- still driving the car would have had it taken off them over a partial credit.
--
-- Only the service role writes this. `booking_enforce_update` still refuses any
-- payment_status change from a signed-in user except the paid → refunded one
-- that comes with a cancellation, and that stays exactly as narrow as it was.

alter type booking_payment_status add value if not exists 'partially_refunded';

-- ---------------------------------------------------------------------------
-- One AutoHire dispute per PayHold case
-- ---------------------------------------------------------------------------
--
-- The `dispute.opened` webhook mirrors a case in, and `payhold-dispute` writes
-- one out. Both can be in flight for the same case at once — PayHold dispatches
-- the event while our POST is still waiting on its response — so the mirror has
-- to be idempotent on something. This is that something.

create unique index if not exists disputes_payhold_dispute_id_key
  on disputes (payhold_dispute_id)
  where payhold_dispute_id is not null and payhold_dispute_id <> '';

-- Both write paths look a dispute up by its booking before touching it, and
-- both use `.maybeSingle()` — which is the code saying out loud that a booking
-- has at most one case. Not a unique constraint: hand-made history may already
-- have two on one booking, and failing this migration over an old row would
-- block the columns above for no gain.

create index if not exists disputes_booking_id_idx on disputes (booking_id);

comment on index disputes_payhold_dispute_id_key is
  'Idempotency for the dispute.opened webhook — the mirror and the outbound push can race on one case.';
