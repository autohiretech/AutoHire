// AutoHire — keep `profiles.payout_status` honest against what PayHold says.
//
// The column is written only twice when a destination is saved: `'pending'` the
// moment it is saved, and `'active'` in the same request IF
// `sellerCapabilities` already says yes at that instant. After that, PayHold's
// own answer moves without any request from AutoHire — the §5.1 security hold
// simply expiring, or a verification being withdrawn — and PayHold sends no
// webhook for either. So a host who could be paid still read "Verifying — being
// checked" on every screen that trusted the column instead of asking again.
//
// This is the asking again. Callers use it wherever they already hold a fresh
// `can_receive_payouts` (`payhold-seller` on every read, and
// `payhold-verify-destination` straight after an admin verifies an account), so
// it costs only a write when the two disagree. Reconciled in both directions:
// PayHold revoking capability (a chargeback, an account un-verified) must
// un-stick a host from a stale "Active" exactly as much as the reverse.
//
// Never touches `'none'` or null — a host with no destination on file has
// nothing here to reconcile.
//
// Only call it with an answer PayHold actually gave. A timeout is not evidence
// of anything, and reconciling against `false` would demote an active host over
// a network hiccup.

/** What the column should say, given PayHold's answer. */
export function derivePayoutStatus(
  currentStatus: string | null,
  canReceivePayouts: boolean,
): string | null {
  if (currentStatus === 'none' || currentStatus === null) return currentStatus;
  return canReceivePayouts ? 'active' : 'pending';
}

/**
 * Write the derived status when it differs, and return it either way.
 *
 * A failed write is logged, not thrown: the caller already has the right answer
 * to show for right now, and the column catches up next time anything asks.
 */
export async function reconcilePayoutStatus(
  currentStatus: string | null,
  canReceivePayouts: boolean,
  write: (status: string) => Promise<void>,
  context: Record<string, unknown> = {},
): Promise<string | null> {
  const derived = derivePayoutStatus(currentStatus, canReceivePayouts);
  if (derived === null || derived === currentStatus) return currentStatus;
  try {
    await write(derived);
  } catch (e) {
    console.error('reconcilePayoutStatus: write failed', {
      ...context,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return derived;
}
