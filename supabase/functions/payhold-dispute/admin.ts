// AutoHire — payhold-dispute: the admin half, kept apart from the HTTP shell in
// `index.ts` so it can run over an in-memory table and a stubbed `fetch`.
//
// Disputes are decided in AutoHire's admin; PayHold moves the money. One rule
// holds that together: **record the decision, then relay the RECORDED decision.**
//
//   1. The admin's decision is validated against the deal and written onto the
//      row (status `under_review`, no `resolved_at`) before PayHold is called.
//   2. Once one is recorded, a DIFFERENT decision is refused
//      (`decision_already_recorded`); the same one, or `retry: true`, relays
//      what the row holds — never anything else the client sends.
//   3. PayHold's answer decides what happens to the row:
//        executed               → payhold_status, status and resolved_at
//        relay setting off      → `not_trusted_yet`, decision kept for a retry
//        resolved differently   → row refreshed from PayHold, 409
//        refused the decision   → nothing moved; the decision is cleared so it
//                                 can be made again
//        down / unknown outcome → decision kept; retry relays the same one
//
// So a timeout followed by a retry sends the same resolution, amount and note
// the admin chose the first time, and PayHold's own "already resolved the same
// way → 200" makes that second send harmless.

import {
  PayHoldError,
  fromMinorUnits,
  getDeal,
  getDispute,
  isDisputeAlreadyResolved,
  isDisputeRelayOff,
  isResolvedPayholdStatus,
  listDisputes,
  payholdConfigured,
  resolveDispute,
  toMinorUnits,
  type Dispute as PayholdDispute,
  type DisputeCase,
  type DisputeResolution,
} from '../_shared/payhold.ts';
import {
  mirrorContextFor,
  mirrorPatch,
  pickCase,
  type BookingRef,
  type DisputeRow,
  type DisputeStore,
} from '../_shared/dispute-mirror.ts';

export class DisputeActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DisputeActionError';
  }
}

export interface AdminDeps {
  store: DisputeStore;
  booking: (bookingId: string) => Promise<BookingRef | null>;
  /** `profiles.full_name` for a profile id, or null when there is none. */
  profileName: (profileId: string) => Promise<string | null>;
}

/** Prefix on `decided_by` for a decision made in AutoHire; the rest is a profile id. */
export const AUTOHIRE_DECIDER_PREFIX = 'autohire-admin:';

/**
 * Who decided, in words, for the admin view. `decided_by` carries a profile id
 * and never a name or email, because both parties can read it; the name is
 * resolved here, server-side. Null for a decider that is not an AutoHire
 * profile (a PayHold staff actor) or a profile with no name.
 */
async function deciderName(decidedBy: string | null, deps: AdminDeps): Promise<string | null> {
  if (!decidedBy?.startsWith(AUTOHIRE_DECIDER_PREFIX)) return null;
  const profileId = decidedBy.slice(AUTOHIRE_DECIDER_PREFIX.length).trim();
  if (!profileId) return null;
  const name = await deps.profileName(profileId).catch(() => null);
  return name?.trim() || null;
}

const RESOLUTIONS: DisputeResolution[] = ['release', 'refund', 'partial_refund'];

const OUTCOME_WORDS: Record<string, string> = {
  release: 'released to the host',
  refund: 'refunded to the renter',
  partial_refund: 'split with a partial refund',
};

/** snake_case row → the web app's camelCase `Dispute`, the same mapping `mapRow` does. */
export function toDisputeJson(row: DisputeRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}

/**
 * The PayHold case behind a row. A row with no id yet — raised before PayHold
 * answered, or mirrored by the old webhook with `''` — is linked to its
 * booking's deal's newest open case (else newest), and the id is written back.
 * A case another row already mirrors is not this row's.
 */
async function linkCase(
  row: DisputeRow,
  deps: AdminDeps,
): Promise<{ row: DisputeRow; payholdId: string | null }> {
  if (row.payhold_dispute_id) return { row, payholdId: row.payhold_dispute_id };

  const booking = await deps.booking(row.booking_id);
  const dealId = booking?.payhold_deal_id;
  if (!dealId) return { row, payholdId: null };

  const picked = pickCase(await listDisputes({ dealId }), dealId);
  if (!picked) return { row, payholdId: null };

  const holder = await deps.store.byPayholdId(picked.id);
  if (holder && holder.id !== row.id) return { row, payholdId: null };

  const updated = await deps.store.update(row.id, { payhold_dispute_id: picked.id });
  return { row: updated, payholdId: picked.id };
}

// ---------------------------------------------------------------------------
// GET ?id= — one dispute and everything PayHold knows about it
// ---------------------------------------------------------------------------

export async function adminDisputeDetail(localId: string, deps: AdminDeps) {
  let row = await deps.store.get(localId);
  if (!row) throw new DisputeActionError('Dispute not found.', 404, 'not_found');
  if (!payholdConfigured()) return {
        dispute: toDisputeJson(row),
        decidedByName: await deciderName(row.decided_by, deps),
        payhold: null,
      };

  const linked = await linkCase(row, deps);
  row = linked.row;
  if (!linked.payholdId) return {
        dispute: toDisputeJson(row),
        decidedByName: await deciderName(row.decided_by, deps),
        payhold: null,
      };

  let ph: DisputeCase;
  try {
    ph = await getDispute(linked.payholdId);
  } catch (e) {
    // The link names a case PayHold does not have — a sandbox reset. Nothing
    // is frozen behind it, which is what `payhold: null` says.
    if (e instanceof PayHoldError && e.status === 404) {
      return {
        dispute: toDisputeJson(row),
        decidedByName: await deciderName(row.decided_by, deps),
        payhold: null,
      };
    }
    throw e;
  }

  const deal = await getDeal(ph.deal_id);
  const currency = deal.currency;

  if (isResolvedPayholdStatus(ph.status) && row.payhold_status !== ph.status) {
    // PayHold executed a decision this row never heard about — a missed
    // webhook. The admin is looking at it now, so this is when to catch up.
    row = await deps.store.update(row.id, mirrorPatch(ph, row, mirrorContextFor(deal)));
  } else if (!row.payhold_status) {
    row = await deps.store.update(row.id, {
      payhold_status: ph.status,
      currency,
      disputed_amount_minor: ph.disputed_amount ?? null,
      reason_code: ph.reason_code ?? row.reason_code ?? null,
    });
  }

  const major = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? null : fromMinorUnits(Number(minor), currency);

  return {
    dispute: toDisputeJson(row),
    decidedByName: await deciderName(row.decided_by, deps),
    payhold: {
      id: ph.id,
      status: ph.status,
      currency,
      dealAmount: fromMinorUnits(Number(deal.amount), currency),
      disputedAmount: major(ph.disputed_amount),
      reasonCode: ph.reason_code ?? null,
      raisedBy: ph.raised_by,
      offers: (ph.offers ?? []).map((o) => ({
        id: o.id,
        kind: o.kind,
        status: o.status,
        amount: major(o.amount),
        offeredBy: o.offered_by,
        createdAt: o.created_at,
      })),
      evidence: (ph.evidence ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        description: e.description,
        reference: e.storage_ref ?? null,
        uploadedBy: e.uploaded_by,
        createdAt: e.created_at,
      })),
      timeline: (ph.timeline ?? []).map((t) => ({
        at: t.at,
        event: t.kind,
        actor: t.actor ?? 'system',
        detail: t.summary ?? '',
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// POST { action: 'resolve' } — record, then relay
// ---------------------------------------------------------------------------

/**
 * The outcome a 409 `dispute_already_resolved` carries in `error.dispute`
 * (`{id, status, resolution, refund_amount, resolved_at, decided_by,
 * reported_decider, decider_source}`), as a case `mirrorPatch` can take — the
 * fallback when the re-read fails or still shows the case open. It holds the
 * decision and nothing else, so the reason code, disputed amount and note are
 * carried over from the row instead of being wiped.
 */
function caseFromConflict(e: PayHoldError, row: DisputeRow): PayholdDispute | null {
  const d = e.details?.dispute as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object' || !isResolvedPayholdStatus(d.status)) return null;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    id: text(d.id) ?? row.payhold_dispute_id ?? '',
    deal_id: '',
    raised_by: 'buyer', // not read by mirrorPatch
    raised_by_actor: null,
    reason: row.reason,
    reason_code: row.reason_code,
    disputed_amount: row.disputed_amount_minor,
    status: d.status,
    opened_at: row.created_at,
    resolved_at: text(d.resolved_at),
    resolution_note: null,
    decided_by: text(d.decided_by),
    reported_decider: text(d.reported_decider),
    decider_source: text(d.decider_source) as PayholdDispute['decider_source'],
    resolution_refund_amount: typeof d.refund_amount === 'number' ? d.refund_amount : null,
  };
}

export interface ResolveResult {
  outcome: 'resolved' | 'not_trusted_yet';
  dispute: Record<string, unknown>;
}

function sameDecision(row: DisputeRow, resolution: string, minor: number | null): boolean {
  if (row.resolution !== resolution) return false;
  return resolution !== 'partial_refund' || Number(row.refund_amount_minor) === minor;
}

function describe(row: DisputeRow): string {
  const words = OUTCOME_WORDS[row.resolution ?? ''] ?? String(row.resolution);
  if (row.resolution === 'partial_refund' && row.refund_amount_minor != null && row.currency) {
    return `${words}, ${fromMinorUnits(Number(row.refund_amount_minor), row.currency)} ${row.currency}`;
  }
  return words;
}

/**
 * `decidedBy` is the caller's — `autohire-admin:<profile id>`, from the session in
 * `index.ts`. Nothing in `body` can name a decider.
 */
export async function resolveAdminDispute(
  body: Record<string, unknown>,
  decidedBy: string,
  deps: AdminDeps,
): Promise<ResolveResult> {
  const disputeId = typeof body.disputeId === 'string' ? body.disputeId.trim() : '';
  if (!disputeId) throw new DisputeActionError('disputeId is required.', 400, 'bad_request');
  const retry = body.retry === true;

  // What the admin asked for, checked before anything is read or written.
  let asked: { resolution: DisputeResolution; note: string; refundAmount?: number } | null = null;
  if (!retry) {
    const resolution = body.resolution as DisputeResolution;
    if (!RESOLUTIONS.includes(resolution)) {
      throw new DisputeActionError(
        'resolution must be release, refund or partial_refund.',
        400,
        'bad_resolution',
      );
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) {
      throw new DisputeActionError(
        'Write a note explaining the decision — both parties are told why.',
        400,
        'note_required',
      );
    }
    let refundAmount: number | undefined;
    if (resolution === 'partial_refund') {
      const n = body.refundAmount;
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
        throw new DisputeActionError(
          'A partial refund needs an amount greater than zero.',
          400,
          'refund_amount_required',
        );
      }
      refundAmount = n;
    }
    asked = { resolution, note, refundAmount };
  }

  if (!payholdConfigured()) {
    throw new DisputeActionError('PayHold is not configured.', 503, 'not_configured');
  }

  let row = await deps.store.get(disputeId);
  if (!row) throw new DisputeActionError('Dispute not found.', 404, 'not_found');

  const linked = await linkCase(row, deps);
  row = linked.row;
  if (!linked.payholdId) {
    throw new DisputeActionError(
      'This dispute has no PayHold case behind it, so no money is being held. Resolve it locally instead.',
      409,
      'no_payhold_case',
    );
  }
  const payholdId = linked.payholdId;

  const ph = await getDispute(payholdId);
  const deal = await getDeal(ph.deal_id);
  const currency = deal.currency;
  const ctx = mirrorContextFor(deal);

  // The admin typed major units of the deal currency; PayHold takes minor.
  let askedMinor: number | null = null;
  if (asked?.resolution === 'partial_refund') {
    askedMinor = toMinorUnits(asked.refundAmount as number, currency);
    if (!Number.isInteger(askedMinor)) {
      throw new DisputeActionError(
        `That amount is finer than ${currency} can express. Round it.`,
        400,
        'invalid_amount',
      );
    }
    if (!(askedMinor > 0 && askedMinor < Number(deal.amount))) {
      throw new DisputeActionError(
        `A partial refund must be more than zero and less than the whole booking ` +
          `(${fromMinorUnits(Number(deal.amount), currency)} ${currency}). To send all of it back, choose refund.`,
        400,
        'refund_out_of_range',
      );
    }
    if (ph.disputed_amount != null && askedMinor > Number(ph.disputed_amount)) {
      throw new DisputeActionError(
        `A partial refund cannot be more than the amount in dispute ` +
          `(${fromMinorUnits(Number(ph.disputed_amount), currency)} ${currency}).`,
        400,
        'refund_exceeds_disputed',
      );
    }
  }

  // Already decided in PayHold — by an earlier attempt of ours, or by a person
  // there. Catch the row up, then say whether it matches what was asked.
  if (isResolvedPayholdStatus(ph.status)) {
    const before = row;
    row = await deps.store.update(row.id, mirrorPatch(ph, row, ctx));
    const wanted = asked
      ? { resolution: asked.resolution as string, minor: askedMinor }
      : before.resolution
      ? { resolution: before.resolution, minor: before.refund_amount_minor }
      : null;
    const matches = !wanted || (
      wanted.resolution === row.resolution &&
      (wanted.resolution !== 'partial_refund' || row.refund_amount_minor == null ||
        Number(wanted.minor) === Number(row.refund_amount_minor))
    );
    if (matches) return { outcome: 'resolved', dispute: toDisputeJson(row) };
    throw new DisputeActionError(
      `PayHold already resolved this case: ${describe(row)}` +
        (row.decided_by ? `, decided by ${row.decided_by}.` : '.'),
      409,
      'dispute_already_resolved',
      { dispute: toDisputeJson(row) },
    );
  }

  // Record the decision — once.
  if (asked) {
    if (row.resolution) {
      if (!sameDecision(row, asked.resolution, askedMinor)) {
        throw new DisputeActionError(
          `A decision is already saved on this dispute (${describe(row)}) and is waiting to reach PayHold. ` +
            'Retry it rather than deciding again.',
          409,
          'decision_already_recorded',
          { dispute: toDisputeJson(row) },
        );
      }
    } else {
      const written = await deps.store.recordDecision(row.id, {
        resolution: asked.resolution,
        refund_amount_minor: askedMinor,
        currency,
        resolution_note: asked.note,
        decided_by: decidedBy,
        status: 'under_review',
      });
      if (written) {
        row = written;
      } else {
        // Another admin recorded one between our read and our write.
        row = (await deps.store.get(row.id)) as DisputeRow;
        if (!row.resolution || !sameDecision(row, asked.resolution, askedMinor)) {
          throw new DisputeActionError(
            `Another decision was saved on this dispute a moment ago (${describe(row)}).`,
            409,
            'decision_already_recorded',
            { dispute: toDisputeJson(row) },
          );
        }
      }
    }
  } else if (!row.resolution) {
    throw new DisputeActionError(
      'There is no saved decision on this dispute to retry.',
      409,
      'no_decision_recorded',
    );
  }

  if (
    row.resolution === 'partial_refund' && row.currency &&
    row.currency.toUpperCase() !== String(currency).toUpperCase()
  ) {
    // The recorded amount is in a currency this deal is not. Relaying it would
    // refund a number in the wrong unit.
    throw new DisputeActionError(
      `The saved refund is in ${row.currency} but the PayHold deal is in ${currency}.`,
      409,
      'currency_mismatch',
      { dispute: toDisputeJson(row) },
    );
  }

  // Relay exactly what is recorded.
  let result: DisputeCase;
  try {
    result = await resolveDispute(payholdId, {
      resolution: row.resolution as DisputeResolution,
      note: row.resolution_note ?? '',
      refundAmount: row.resolution === 'partial_refund' ? Number(row.refund_amount_minor) : undefined,
      decidedBy: row.decided_by ?? decidedBy,
    });
  } catch (e) {
    if (isDisputeRelayOff(e)) {
      return { outcome: 'not_trusted_yet', dispute: toDisputeJson(row) };
    }

    if (e instanceof PayHoldError && e.status === 409) {
      // Resolved already — the contract's `dispute_already_resolved`, or any
      // other 409 that turns out to mean the same. PayHold says what happened.
      // The case as PayHold now reads, else the outcome the 409 itself carries.
      let fresh: PayholdDispute | null = await getDispute(payholdId).catch(() => null);
      if (!fresh || !isResolvedPayholdStatus(fresh.status)) fresh = caseFromConflict(e, row) ?? fresh;
      if (fresh && isResolvedPayholdStatus(fresh.status)) {
        const before = row;
        row = await deps.store.update(row.id, mirrorPatch(fresh, row, ctx));
        if (sameDecision(row, before.resolution as string, before.refund_amount_minor == null ? null : Number(before.refund_amount_minor))) {
          return { outcome: 'resolved', dispute: toDisputeJson(row) };
        }
        throw new DisputeActionError(e.message, 409, 'dispute_already_resolved', {
          dispute: toDisputeJson(row),
        });
      }
      if (isDisputeAlreadyResolved(e)) {
        throw new DisputeActionError(e.message, 409, 'dispute_already_resolved', {
          dispute: toDisputeJson(row),
        });
      }
    }

    if (e instanceof PayHoldError && [400, 404, 409, 422].includes(e.status)) {
      // PayHold looked at the decision and said no. No money moved, so the
      // recorded decision is safe to forget — and must be, or step 2 above
      // would refuse every corrected one forever.
      row = await deps.store.clearDecision(row.id);
      throw new DisputeActionError(
        `PayHold refused this decision: ${e.message} Nothing moved; decide it again.`,
        e.status === 404 ? 409 : e.status,
        'payhold_refused',
        { dispute: toDisputeJson(row) },
      );
    }

    // Down, timed out, or an answer that does not say whether it executed.
    // The decision stays recorded, and a retry sends the same one.
    const message = e instanceof Error ? e.message : String(e);
    throw new DisputeActionError(
      `PayHold did not confirm the decision (${message}). It is saved — retry it.`,
      502,
      'payhold_unavailable',
      { dispute: toDisputeJson(row) },
    );
  }

  if (!isResolvedPayholdStatus(result?.status)) {
    throw new DisputeActionError(
      'PayHold took the decision but still shows the case open. It is saved — retry in a moment.',
      502,
      'payhold_still_open',
      { dispute: toDisputeJson(row) },
    );
  }

  row = await deps.store.update(row.id, mirrorPatch(result, row, ctx));
  return { outcome: 'resolved', dispute: toDisputeJson(row) };
}
