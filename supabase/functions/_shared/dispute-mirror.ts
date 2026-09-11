// AutoHire — the PayHold case ↔ `disputes` row mirror.
//
// Shared by `payhold-webhook` (dispute.opened / dispute.resolved /
// deal.dispute_resolved) and `payhold-dispute` (the admin's detail view and
// decision relay), so both write a case into a row the same way.
//
// Two rules, both learned from the webhook's first version of this:
//
//   1. The event payload names where to look and nothing more. The case itself
//      — who raised it, its status, the decision — is read back from PayHold
//      (`getDispute` / `listDisputes`), the same trust boundary the deal events
//      keep with `getDeal`. Older `dispute.opened` events carried `{}` at all,
//      which is how that first version stored a blank `payhold_dispute_id`.
//   2. A row is matched by its PayHold id first, and only then by booking —
//      and by booking only when the row is still OPEN and not yet linked to some
//      other case. Matching a booking's resolved dispute would re-open history.
//
// The store is an interface so the whole mirror can be run in tests over an
// in-memory table and a stubbed `fetch`.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  PayHoldError,
  fromMinorUnits,
  getDispute,
  isResolvedPayholdStatus,
  listDisputes,
  localDisputeStatus,
  resolutionForPayholdStatus,
  type DealAmounts,
  type Dispute as PayholdDispute,
} from './payhold.ts';

/** A `disputes` row, migrations 047 + 077 included. */
export interface DisputeRow {
  id: string;
  booking_id: string;
  raised_by: string;
  against: string;
  reason: string;
  amount_rwf: number;
  created_at: string;
  status: string;
  payhold_dispute_id: string | null;
  payhold_status: string | null;
  resolution: string | null;
  refund_amount_minor: number | null;
  currency: string | null;
  disputed_amount_minor: number | null;
  resolution_note: string | null;
  decided_by: string | null;
  resolved_at: string | null;
  reason_code: string | null;
}

export interface BookingRef {
  id: string;
  renter_id: string;
  host_id: string;
  total_rwf: number | null;
  charge_currency: string | null;
  payhold_deal_id?: string | null;
}

/** The decision an admin makes, as it is recorded before being relayed. */
export type RecordedDecision = Pick<
  DisputeRow,
  'resolution' | 'refund_amount_minor' | 'currency' | 'resolution_note' | 'decided_by' | 'status'
>;

export interface DisputeStore {
  get(id: string): Promise<DisputeRow | null>;
  byPayholdId(payholdId: string): Promise<DisputeRow | null>;
  /** The newest open/under_review row on a booking that is not linked to any case yet. */
  activeUnlinkedForBooking(bookingId: string): Promise<DisputeRow | null>;
  insert(row: DisputeRow): Promise<DisputeRow>;
  update(id: string, patch: Partial<DisputeRow>): Promise<DisputeRow>;
  /** Writes only while no decision is recorded. Null when another admin got there first. */
  recordDecision(id: string, decision: RecordedDecision): Promise<DisputeRow | null>;
  /** Forget an unexecuted decision PayHold refused outright. Never touches an executed one. */
  clearDecision(id: string): Promise<DisputeRow>;
}

const ACTIVE = ['open', 'under_review'];

export function supabaseDisputeStore(db: SupabaseClient): DisputeStore {
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  const store: DisputeStore = {
    async get(id) {
      const { data, error } = await db.from('disputes').select('*').eq('id', id).maybeSingle();
      check(error);
      return (data as DisputeRow | null) ?? null;
    },
    async byPayholdId(payholdId) {
      if (!payholdId) return null;
      const { data, error } = await db
        .from('disputes')
        .select('*')
        .eq('payhold_dispute_id', payholdId)
        .maybeSingle();
      check(error);
      return (data as DisputeRow | null) ?? null;
    },
    async activeUnlinkedForBooking(bookingId) {
      const { data, error } = await db
        .from('disputes')
        .select('*')
        .eq('booking_id', bookingId)
        .in('status', ACTIVE)
        .order('created_at', { ascending: false });
      check(error);
      return ((data ?? []) as DisputeRow[]).find((r) => !r.payhold_dispute_id) ?? null;
    },
    async insert(row) {
      const { data, error } = await db.from('disputes').insert(row).select('*').single();
      check(error);
      return data as DisputeRow;
    },
    async update(id, patch) {
      const { data, error } = await db.from('disputes').update(patch).eq('id', id).select('*').single();
      check(error);
      return data as DisputeRow;
    },
    async recordDecision(id, decision) {
      const { data, error } = await db
        .from('disputes')
        .update(decision)
        .eq('id', id)
        .is('resolution', null)
        .select('*');
      check(error);
      return ((data ?? []) as DisputeRow[])[0] ?? null;
    },
    async clearDecision(id) {
      const { data, error } = await db
        .from('disputes')
        .update({ resolution: null, refund_amount_minor: null, resolution_note: null, decided_by: null })
        .eq('id', id)
        .is('resolved_at', null)
        .select('*');
      check(error);
      return ((data ?? []) as DisputeRow[])[0] ?? ((await store.get(id)) as DisputeRow);
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

export interface MirrorContext {
  /** The PayHold deal currency — what every minor amount on the case is in. */
  currency: string | null;
  /** What the deal's ledger says went back to the renter, when it is in `currency`. */
  refundedMinor?: number | null;
  now?: string;
}

/** The mirror context a deal gives. `amounts` is only trusted in the deal's own currency. */
export function mirrorContextFor(deal: {
  currency: string;
  amounts?: DealAmounts | null;
}): MirrorContext {
  const amounts = deal.amounts;
  const sameCurrency = !!amounts &&
    String(amounts.currency ?? '').toUpperCase() === String(deal.currency ?? '').toUpperCase();
  return {
    currency: deal.currency || null,
    refundedMinor: sameCurrency ? Number(amounts!.refunded ?? 0) || null : null,
  };
}

/**
 * The newest OPEN case on a deal, else the newest case at all. Filtered to the
 * deal here, whatever the server did with the filter.
 */
export function pickCase(cases: PayholdDispute[], dealId: string): PayholdDispute | null {
  const mine = cases
    .filter((c) => c.deal_id === dealId)
    .sort((a, b) => String(b.opened_at ?? '').localeCompare(String(a.opened_at ?? '')));
  return mine.find((c) => c.status === 'open') ?? mine[0] ?? null;
}

/**
 * The fields a row takes from its PayHold case.
 *
 * An open case leaves the decision columns alone — a decision recorded here
 * and not yet relayed stays exactly as the admin made it. A resolved case
 * writes PayHold's outcome over them, because that outcome is what the money
 * did. A split's amount survives only when the recorded decision was also a
 * split; otherwise it comes from the deal's ledger, or stays unknown.
 */
export function mirrorPatch(
  ph: PayholdDispute,
  row: DisputeRow | null,
  ctx: MirrorContext,
): Partial<DisputeRow> {
  const patch: Partial<DisputeRow> = {
    payhold_status: ph.status,
    status: localDisputeStatus(ph.status, row?.status),
    reason_code: ph.reason_code ?? row?.reason_code ?? null,
    disputed_amount_minor: ph.disputed_amount ?? null,
    currency: ctx.currency ?? row?.currency ?? null,
  };

  const decided = resolutionForPayholdStatus(ph.status);
  if (decided) {
    const keptAmount = decided === 'partial_refund' && row?.resolution === 'partial_refund' &&
        row.refund_amount_minor != null
      ? Number(row.refund_amount_minor)
      : null;
    patch.resolution = decided;
    patch.refund_amount_minor = decided === 'partial_refund'
      ? keptAmount ?? (ctx.refundedMinor && ctx.refundedMinor > 0 ? ctx.refundedMinor : null)
      : null;
    patch.resolution_note = ph.resolution_note ?? row?.resolution_note ?? null;
    patch.decided_by = ph.decided_by ?? row?.decided_by ?? null;
    patch.resolved_at = ph.resolved_at ?? row?.resolved_at ?? ctx.now ?? new Date().toISOString();
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Finding the case and the row
// ---------------------------------------------------------------------------

/**
 * Which PayHold case an event is about. The id the event names is used only if
 * PayHold confirms that case is on this deal — a signed event from our own
 * tenant is still not allowed to point one booking's mirror at another deal's
 * case. Without a usable id, the deal's newest open case (else newest) wins.
 */
export async function locateCase(dealId: string, hintedId: unknown): Promise<PayholdDispute | null> {
  const hinted = typeof hintedId === 'string' ? hintedId.trim() : '';
  if (hinted) {
    try {
      const found = await getDispute(hinted);
      if (found.deal_id === dealId) return found;
      console.warn('[dispute-mirror] event named a case on another deal; ignoring the id', {
        dealId,
        hinted,
      });
    } catch (e) {
      if (!(e instanceof PayHoldError && e.status === 404)) throw e;
    }
  }
  return pickCase(await listDisputes({ dealId }), dealId);
}

export interface MirrorOutcome {
  action: 'inserted' | 'updated' | 'skipped' | 'none';
  disputeId: string | null;
  payholdDisputeId: string | null;
  reason?: string;
}

/** Write one case into its row — found by PayHold id, then by open booking row, else created. */
export async function syncCase(
  store: DisputeStore,
  booking: BookingRef,
  ph: PayholdDispute,
  ctx: MirrorContext,
  opts: { skipIfResolved?: boolean } = {},
): Promise<MirrorOutcome> {
  let row = await store.byPayholdId(ph.id);
  if (row && row.booking_id !== booking.id) {
    console.error('[dispute-mirror] case is already mirrored onto a different booking', {
      payholdDisputeId: ph.id,
      row: row.id,
      booking: booking.id,
    });
    return { action: 'none', disputeId: null, payholdDisputeId: ph.id, reason: 'bound_to_other_booking' };
  }
  row ??= await store.activeUnlinkedForBooking(booking.id);

  if (row && opts.skipIfResolved && isResolvedPayholdStatus(row.payhold_status)) {
    return { action: 'skipped', disputeId: row.id, payholdDisputeId: ph.id, reason: 'already_resolved' };
  }

  if (row) {
    const updated = await store.update(row.id, {
      ...(row.payhold_dispute_id ? {} : { payhold_dispute_id: ph.id }),
      ...mirrorPatch(ph, row, ctx),
    });
    return { action: 'updated', disputeId: updated.id, payholdDisputeId: ph.id };
  }

  // The seller raised it → the host is the raiser. Anything else, including a
  // PayHold too old to say, reads as the renter — the side that usually does.
  const hostRaised = ph.raised_by === 'seller';
  const amountRwf = ph.disputed_amount != null && ctx.currency
    ? Math.round(fromMinorUnits(Number(ph.disputed_amount), ctx.currency))
    : Math.round(Number(booking.total_rwf ?? 0));

  const fresh: DisputeRow = {
    id: `dsp-${Date.now()}`,
    booking_id: booking.id,
    raised_by: hostRaised ? booking.host_id : booking.renter_id,
    against: hostRaised ? booking.renter_id : booking.host_id,
    reason: String(ph.reason ?? '').trim() || 'Opened in PayHold',
    amount_rwf: amountRwf,
    created_at: ph.opened_at ?? new Date().toISOString(),
    status: 'open',
    payhold_dispute_id: ph.id,
    payhold_status: null,
    resolution: null,
    refund_amount_minor: null,
    currency: null,
    disputed_amount_minor: null,
    resolution_note: null,
    decided_by: null,
    resolved_at: null,
    reason_code: null,
    ...mirrorPatch(ph, null, ctx),
  };

  try {
    const inserted = await store.insert(fresh);
    return { action: 'inserted', disputeId: inserted.id, payholdDisputeId: ph.id };
  } catch (e) {
    // The unique index on payhold_dispute_id: a concurrent delivery, or
    // `payhold-dispute`'s own write, mirrored it first.
    const raced = await store.byPayholdId(ph.id);
    if (!raced) throw e;
    const updated = await store.update(raced.id, mirrorPatch(ph, raced, ctx));
    return { action: 'updated', disputeId: updated.id, payholdDisputeId: ph.id };
  }
}

type DealForMirror = { id: string; currency: string; amounts?: DealAmounts | null };

/** `dispute.opened` — old events carried `{}`; new ones `{dispute_id, raised_by, …}`. */
export async function mirrorDisputeOpened(
  store: DisputeStore,
  booking: BookingRef,
  deal: DealForMirror,
  data: Record<string, unknown> | null | undefined,
): Promise<MirrorOutcome> {
  const ph = await locateCase(deal.id, data?.dispute_id);
  if (!ph) {
    console.error('[dispute-mirror] dispute.opened, but PayHold has no case on this deal', {
      deal: deal.id,
    });
    return { action: 'none', disputeId: null, payholdDisputeId: null, reason: 'no_case' };
  }
  return await syncCase(store, booking, ph, mirrorContextFor(deal));
}

/**
 * `dispute.resolved` (preferred) and the legacy `deal.dispute_resolved`.
 *
 * Neither payload's outcome is used: the legacy one reports a split as
 * `refund`, and both are read back from PayHold anyway. The legacy event is
 * additionally ignored once the row is resolved, so it can never overwrite
 * what `dispute.resolved` already wrote.
 */
export async function mirrorDisputeResolved(
  store: DisputeStore,
  booking: BookingRef,
  deal: DealForMirror,
  data: Record<string, unknown> | null | undefined,
  legacy: boolean,
): Promise<MirrorOutcome> {
  const ph = await locateCase(deal.id, data?.dispute_id);
  if (!ph) return { action: 'none', disputeId: null, payholdDisputeId: null, reason: 'no_case' };
  return await syncCase(store, booking, ph, mirrorContextFor(deal), { skipIfResolved: legacy });
}
