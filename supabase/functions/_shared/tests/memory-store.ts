// An in-memory `disputes` table implementing `DisputeStore`, with the unique
// index on `payhold_dispute_id` that the real table has (migration 048). Test
// helper only — nothing deployed imports it.

import type { DisputeRow, DisputeStore } from '../dispute-mirror.ts';

export function row(overrides: Partial<DisputeRow> & { id: string; booking_id: string }): DisputeRow {
  return {
    raised_by: 'renter-1',
    against: 'host-1',
    reason: 'The car came back with a dented door.',
    amount_rwf: 100,
    created_at: '2026-09-01T00:00:00Z',
    status: 'open',
    payhold_dispute_id: null,
    payhold_status: null,
    resolution: null,
    refund_amount_minor: null,
    currency: null,
    disputed_amount_minor: null,
    resolution_note: null,
    decided_by: null,
    resolved_at: null,
    reason_code: null,
    ...overrides,
  };
}

export function memoryStore(seed: DisputeRow[] = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  const writes: { op: string; id: string; patch?: Partial<DisputeRow> }[] = [];
  let seq = 0;

  const unique = (candidate: DisputeRow) => {
    const pid = candidate.payhold_dispute_id;
    if (!pid) return;
    for (const other of rows.values()) {
      if (other.id !== candidate.id && other.payhold_dispute_id === pid) {
        throw new Error('duplicate key value violates unique constraint "disputes_payhold_dispute_id_key"');
      }
    }
  };

  const store: DisputeStore = {
    get: (id) => Promise.resolve(rows.has(id) ? { ...rows.get(id)! } : null),
    byPayholdId: (pid) =>
      Promise.resolve(
        pid ? ([...rows.values()].find((r) => r.payhold_dispute_id === pid) ?? null) : null,
      ),
    activeUnlinkedForBooking: (bookingId) =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => r.booking_id === bookingId && ['open', 'under_review'].includes(r.status))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .find((r) => !r.payhold_dispute_id) ?? null,
      ),
    insert: (r) => {
      // Real ids are `dsp-${Date.now()}`; two in one millisecond would collide here.
      const inserted = { ...r, id: rows.has(r.id) ? `${r.id}-${++seq}` : r.id };
      unique(inserted);
      rows.set(inserted.id, inserted);
      writes.push({ op: 'insert', id: inserted.id });
      return Promise.resolve({ ...inserted });
    },
    update: (id, patch) => {
      const next = { ...rows.get(id)!, ...patch };
      unique(next);
      rows.set(id, next);
      writes.push({ op: 'update', id, patch });
      return Promise.resolve({ ...next });
    },
    recordDecision: (id, decision) => {
      const current = rows.get(id)!;
      if (current.resolution !== null) return Promise.resolve(null);
      const next = { ...current, ...decision };
      rows.set(id, next);
      writes.push({ op: 'recordDecision', id, patch: decision });
      return Promise.resolve({ ...next });
    },
    clearDecision: (id) => {
      const current = rows.get(id)!;
      if (current.resolved_at === null) {
        const next = {
          ...current,
          resolution: null,
          refund_amount_minor: null,
          resolution_note: null,
          decided_by: null,
        };
        rows.set(id, next);
        writes.push({ op: 'clearDecision', id });
      }
      return Promise.resolve({ ...rows.get(id)! });
    },
  };

  return { store, rows, writes };
}
