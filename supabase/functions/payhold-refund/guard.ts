// AutoHire — payhold-refund: the under-dispute guard, kept apart from the HTTP
// shell in `index.ts` so it can run over a stubbed `fetch`.
//
// Not while a dispute is open. A refund would move the renter's money on one
// person's say-so while a case about that same money is waiting on a decision
// — and the decision, when it comes, moves money too. Disputed money moves
// once, through Admin → Disputes (`payhold-dispute`), which has PayHold
// execute it.
//
// Both records are checked, because either can know before the other does: a
// case opened in PayHold reaches `disputes` only when its webhook lands, and a
// decision recorded here but not yet relayed (status `under_review`) is not
// visible to PayHold at all.
//
// Fails closed. Not knowing whether the money is under dispute is not
// permission to move it.

import { hasOpenDisputeOnDeal } from '../_shared/payhold.ts';

export interface RefundGuardDeps {
  /** Does `disputes` have an open or under_review row for this booking? Throws if it cannot tell. */
  hasActiveLocalDispute: (bookingId: string) => Promise<boolean>;
  /** Is a case open on this deal in PayHold? Defaults to asking PayHold. */
  hasOpenPayholdDispute?: (dealId: string) => Promise<boolean>;
}

export interface GuardRefusal {
  status: number;
  body: { error: string; code: string; detail?: string };
}

const UNDER_DISPUTE: GuardRefusal = {
  status: 409,
  body: {
    error: 'This booking is under dispute — decide it in Admin → Disputes.',
    code: 'under_dispute',
  },
};

/** A refusal to send, or null when the refund may go ahead. */
export async function disputeRefundGuard(
  booking: { id: string; payhold_deal_id: string },
  deps: RefundGuardDeps,
): Promise<GuardRefusal | null> {
  let local: boolean;
  try {
    local = await deps.hasActiveLocalDispute(booking.id);
  } catch (e) {
    return {
      status: 500,
      body: {
        error: 'Could not check this booking for an open dispute, so no refund was sent.',
        code: 'dispute_check_failed',
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  }
  // Local first: it is the cheaper read, and a hit needs no PayHold round trip.
  if (local) return UNDER_DISPUTE;

  const askPayhold = deps.hasOpenPayholdDispute ?? hasOpenDisputeOnDeal;
  try {
    if (await askPayhold(booking.payhold_deal_id)) return UNDER_DISPUTE;
  } catch (e) {
    return {
      status: 502,
      body: {
        error:
          'Could not check PayHold for an open dispute on this booking, so no refund was sent. Try again shortly.',
        code: 'dispute_check_failed',
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  }
  return null;
}
