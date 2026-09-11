import { assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.0';
import { memoryStore, row } from '../_shared/tests/memory-store.ts';
import type { BookingRef, DisputeRow } from '../_shared/dispute-mirror.ts';

// See sync.test.ts: payhold.ts reads its env at module scope, so it is
// imported only after the env is in place.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const { DisputeActionError, adminDisputeDetail, resolveAdminDispute } = await import('./admin.ts');

/**
 * Admin → Disputes decides; PayHold moves the money. What is pinned here is
 * the record-then-relay rule: the decision is written first, and what reaches
 * PayHold is what was written — on the first attempt, on a retry after the
 * relay setting was off, and never a different decision typed afterwards.
 */

type Reply = { status: number; body: unknown };
const ADMIN = 'autohire-admin:ops@example.com';

// deno-lint-ignore no-explicit-any
function phCase(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'ph-1',
    deal_id: 'deal-1',
    raised_by: 'buyer',
    raised_by_actor: null,
    reason: 'Dented door',
    reason_code: 'damaged',
    disputed_amount: 15000,
    status: 'open',
    opened_at: '2026-09-02T10:00:00Z',
    resolved_at: null,
    resolution_note: null,
    decided_by: null,
    offers: [],
    evidence: [],
    timeline: [],
    ...overrides,
  };
}

const resolvedAs: Record<string, string> = {
  release: 'resolved_released',
  refund: 'resolved_refunded',
  partial_refund: 'resolved_split',
};

/**
 * A PayHold with one case on one deal. `resolve` answers the POST; by default
 * it executes the decision and the case becomes resolved for later reads.
 */
function payhold(opts: {
  // deno-lint-ignore no-explicit-any
  case?: Record<string, any>;
  // deno-lint-ignore no-explicit-any
  deal?: Record<string, any>;
  // deno-lint-ignore no-explicit-any
  resolve?: (body: any) => Reply;
} = {}) {
  let current = phCase(opts.case);
  const deal = { id: 'deal-1', amount: 20000, currency: 'USD', status: 'disputed', amounts: null, ...opts.deal };
  const calls: { method: string; path: string; body: unknown }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '') + url.search;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });

    let reply: Reply;
    if (method === 'POST' && path === `/disputes/${current.id}/resolve`) {
      if (opts.resolve) {
        reply = opts.resolve(body);
      } else {
        current = {
          ...current,
          status: resolvedAs[body.resolution],
          resolved_at: '2026-09-06T09:00:00Z',
          resolution_note: body.note,
          decided_by: body.decided_by,
        };
        reply = { status: 200, body: current };
      }
    } else if (method === 'GET' && path === `/disputes/${current.id}`) {
      reply = { status: 200, body: current };
    } else if (method === 'GET' && path.startsWith('/disputes?')) {
      reply = { status: 200, body: { disputes: [current] } };
    } else if (method === 'GET' && path === `/deals/${deal.id}`) {
      reply = { status: 200, body: deal };
    } else {
      reply = { status: 599, body: { error: { code: 'unexpected', message: `unexpected ${method} ${path}` } } };
    }
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  return {
    calls,
    resolves: () => calls.filter((c) => c.method === 'POST'),
    // deno-lint-ignore no-explicit-any
    setCase: (c: Record<string, any>) => { current = phCase(c); },
    restore: () => { globalThis.fetch = original; },
  };
}

const booking: BookingRef = {
  id: 'bk-1',
  renter_id: 'renter-1',
  host_id: 'host-1',
  total_rwf: 200,
  charge_currency: 'USD',
  payhold_deal_id: 'deal-1',
};

function setup(seed: Partial<DisputeRow> = {}) {
  const mem = memoryStore([
    row({ id: 'dsp-1', booking_id: 'bk-1', payhold_dispute_id: 'ph-1', ...seed }),
  ]);
  return { ...mem, deps: { store: mem.store, booking: () => Promise.resolve(booking) } };
}

async function refusal(fn: () => Promise<unknown>) {
  const e = await assertRejects(fn, DisputeActionError);
  return e as InstanceType<typeof DisputeActionError>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

Deno.test('a decision without a note is refused before anything is read or written', async () => {
  const { deps, writes } = setup();
  const ph = payhold();
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: '   ' }, ADMIN, deps)
    );
    assertEquals(e.status, 400);
    assertEquals(e.code, 'note_required');
    assertEquals(ph.calls.length, 0);
    assertEquals(writes.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('a partial refund must be above zero, below the deal and within the disputed amount', async () => {
  const { deps, writes } = setup();
  const ph = payhold(); // deal 200.00 USD, disputed 150.00 USD
  try {
    const tooBig = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'partial_refund', refundAmount: 200, note: 'x' }, ADMIN, deps)
    );
    assertEquals(tooBig.code, 'refund_out_of_range');

    const overDisputed = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'partial_refund', refundAmount: 150.01, note: 'x' }, ADMIN, deps)
    );
    assertEquals(overDisputed.code, 'refund_exceeds_disputed');

    const none = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'partial_refund', note: 'x' }, ADMIN, deps)
    );
    assertEquals(none.code, 'refund_amount_required');

    assertEquals(ph.resolves().length, 0);
    assertEquals(writes.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('a zero-decimal currency refuses a fractional amount rather than rounding money', async () => {
  const { deps } = setup();
  const ph = payhold({ deal: { amount: 50000, currency: 'RWF' }, case: { disputed_amount: null } });
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'partial_refund', refundAmount: 1500.5, note: 'x' }, ADMIN, deps)
    );
    assertEquals(e.code, 'invalid_amount');
    assertEquals(ph.resolves().length, 0);
  } finally {
    ph.restore();
  }
});

// ---------------------------------------------------------------------------
// Record, then relay
// ---------------------------------------------------------------------------

Deno.test('a decision is recorded, relayed as recorded, and the row follows PayHold', async () => {
  const { deps, rows, writes } = setup();
  const ph = payhold();
  try {
    const out = await resolveAdminDispute(
      { disputeId: 'dsp-1', resolution: 'partial_refund', refundAmount: 12.34, note: 'Half the repair.', decidedBy: 'someone-else' },
      ADMIN,
      deps,
    );
    assertEquals(out.outcome, 'resolved');

    // Recorded before the relay, as under_review with no resolved_at.
    const recorded = writes.find((w) => w.op === 'recordDecision')!;
    assertEquals(recorded.patch, {
      resolution: 'partial_refund',
      refund_amount_minor: 1234,
      currency: 'USD',
      resolution_note: 'Half the repair.',
      decided_by: ADMIN,
      status: 'under_review',
    });

    // The body's decidedBy is ignored — the session's name goes.
    assertEquals(ph.resolves()[0].body, {
      resolution: 'partial_refund',
      note: 'Half the repair.',
      decided_by: ADMIN,
      refund_amount: 1234,
    });

    const r = rows.get('dsp-1')!;
    assertEquals(r.status, 'resolved_split');
    assertEquals(r.payhold_status, 'resolved_split');
    assertEquals(r.refund_amount_minor, 1234);
    assertEquals(r.resolved_at, '2026-09-06T09:00:00Z');
    assertEquals(out.dispute.status, 'resolved_split');
    assertEquals(out.dispute.refundAmountMinor, 1234);
  } finally {
    ph.restore();
  }
});

Deno.test('relay switched off: not_trusted_yet, and the decision waits on the row', async () => {
  const { deps, rows } = setup();
  const ph = payhold({
    resolve: () => ({
      status: 422,
      body: { error: { code: 'dispute_relay_off', message: 'Turn on dispute decision relay in Settings' } },
    }),
  });
  try {
    const out = await resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: 'Pre-existing dent.' }, ADMIN, deps);
    assertEquals(out.outcome, 'not_trusted_yet');
    const r = rows.get('dsp-1')!;
    assertEquals(r.status, 'under_review');
    assertEquals(r.resolution, 'release');
    assertEquals(r.decided_by, ADMIN);
    assertEquals(r.resolved_at, null);
    assertEquals(out.dispute.resolution, 'release');
    assertEquals(ph.resolves().length, 1);
  } finally {
    ph.restore();
  }
});

Deno.test('once a decision waits, a different one is refused and nothing is sent', async () => {
  const { deps, rows } = setup({
    status: 'under_review',
    resolution: 'release',
    resolution_note: 'Pre-existing dent.',
    decided_by: 'autohire-admin:first@example.com',
    currency: 'USD',
  });
  const ph = payhold();
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'refund', note: 'Changed my mind.' }, ADMIN, deps)
    );
    assertEquals(e.status, 409);
    assertEquals(e.code, 'decision_already_recorded');
    assertEquals(ph.resolves().length, 0);
    assertEquals(rows.get('dsp-1')!.resolution, 'release');
  } finally {
    ph.restore();
  }
});

Deno.test('a different split amount is a different decision', async () => {
  const { deps } = setup({
    status: 'under_review',
    resolution: 'partial_refund',
    refund_amount_minor: 1000,
    resolution_note: 'Ten dollars.',
    decided_by: ADMIN,
    currency: 'USD',
  });
  const ph = payhold();
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'partial_refund', refundAmount: 20, note: 'x' }, ADMIN, deps)
    );
    assertEquals(e.code, 'decision_already_recorded');
    assertEquals(ph.resolves().length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('retry relays the recorded decision — its decider and note, not the retrier or the body', async () => {
  const { deps, rows } = setup({
    status: 'under_review',
    resolution: 'partial_refund',
    refund_amount_minor: 1000,
    resolution_note: 'Ten dollars.',
    decided_by: 'autohire-admin:first@example.com',
    currency: 'USD',
  });
  const ph = payhold();
  try {
    const out = await resolveAdminDispute(
      { disputeId: 'dsp-1', retry: true, resolution: 'refund', refundAmount: 999, note: 'ignored' },
      ADMIN,
      deps,
    );
    assertEquals(out.outcome, 'resolved');
    assertEquals(ph.resolves()[0].body, {
      resolution: 'partial_refund',
      note: 'Ten dollars.',
      decided_by: 'autohire-admin:first@example.com',
      refund_amount: 1000,
    });
    assertEquals(rows.get('dsp-1')!.status, 'resolved_split');
  } finally {
    ph.restore();
  }
});

Deno.test('the same decision again relays the recorded one', async () => {
  const { deps } = setup({
    status: 'under_review',
    resolution: 'release',
    resolution_note: 'Original note.',
    decided_by: 'autohire-admin:first@example.com',
    currency: 'USD',
  });
  const ph = payhold();
  try {
    const out = await resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: 'New wording.' }, ADMIN, deps);
    assertEquals(out.outcome, 'resolved');
    assertEquals(ph.resolves()[0].body, {
      resolution: 'release',
      note: 'Original note.',
      decided_by: 'autohire-admin:first@example.com',
    });
  } finally {
    ph.restore();
  }
});

Deno.test('retry with nothing recorded is refused', async () => {
  const { deps } = setup();
  const ph = payhold();
  try {
    const e = await refusal(() => resolveAdminDispute({ disputeId: 'dsp-1', retry: true }, ADMIN, deps));
    assertEquals(e.code, 'no_decision_recorded');
    assertEquals(ph.resolves().length, 0);
  } finally {
    ph.restore();
  }
});

// ---------------------------------------------------------------------------
// Already resolved in PayHold
// ---------------------------------------------------------------------------

Deno.test('already resolved the same way in PayHold: resolved, and nothing is sent', async () => {
  const { deps, rows } = setup();
  const ph = payhold({
    case: { status: 'resolved_released', resolved_at: '2026-09-04T00:00:00Z', decided_by: 'staff:jo' },
  });
  try {
    const out = await resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: 'x' }, ADMIN, deps);
    assertEquals(out.outcome, 'resolved');
    assertEquals(ph.resolves().length, 0);
    assertEquals(rows.get('dsp-1')!.status, 'resolved_host');
  } finally {
    ph.restore();
  }
});

Deno.test('already resolved differently in PayHold: 409, with the row caught up to what happened', async () => {
  const { deps, rows } = setup();
  const ph = payhold({
    case: { status: 'resolved_released', resolved_at: '2026-09-04T00:00:00Z', decided_by: 'staff:jo' },
  });
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'refund', note: 'x' }, ADMIN, deps)
    );
    assertEquals(e.status, 409);
    assertEquals(e.code, 'dispute_already_resolved');
    assertEquals(ph.resolves().length, 0);
    const r = rows.get('dsp-1')!;
    assertEquals(r.status, 'resolved_host');
    assertEquals(r.resolution, 'release');
    assertEquals(r.decided_by, 'staff:jo');
  } finally {
    ph.restore();
  }
});

Deno.test('a 409 dispute_already_resolved on relay refreshes the row from PayHold and reports it', async () => {
  const { deps, rows } = setup();
  let resolvedMeanwhile = false;
  const ph = payhold({
    resolve: () => {
      resolvedMeanwhile = true;
      return {
        status: 409,
        body: { error: { code: 'dispute_already_resolved', message: 'This case was already resolved as a refund.' } },
      };
    },
  });
  try {
    // The case flips to refunded between our read and our relay.
    const e = await refusal(async () => {
      const p = resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: 'x' }, ADMIN, deps);
      return await p;
    });
    assertEquals(resolvedMeanwhile, true);
    assertEquals(e.code, 'dispute_already_resolved');
    assertEquals(e.message, 'This case was already resolved as a refund.');
    // The GET after the 409 still shows `open` in this stub, so the row keeps
    // the recorded decision rather than inventing an outcome.
    assertEquals(rows.get('dsp-1')!.resolution, 'release');
  } finally {
    ph.restore();
  }
});

Deno.test('a 409 whose re-read shows a different outcome writes that outcome over the recorded one', async () => {
  const { deps, rows } = setup();
  // deno-lint-ignore prefer-const
  let ph: ReturnType<typeof payhold>;
  ph = payhold({
    resolve: () => {
      ph.setCase({ status: 'resolved_refunded', resolved_at: '2026-09-06T00:00:00Z', decided_by: 'staff:jo' });
      return { status: 409, body: { error: { code: 'dispute_already_resolved', message: 'Resolved differently.' } } };
    },
  });
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: 'x' }, ADMIN, deps)
    );
    assertEquals(e.code, 'dispute_already_resolved');
    const r = rows.get('dsp-1')!;
    assertEquals(r.status, 'resolved_renter');
    assertEquals(r.resolution, 'refund');
    assertEquals(r.decided_by, 'staff:jo');
  } finally {
    ph.restore();
  }
});

// ---------------------------------------------------------------------------
// Other failures
// ---------------------------------------------------------------------------

Deno.test('PayHold refusing the decision itself clears it, so it can be decided again', async () => {
  const { deps, rows } = setup();
  const ph = payhold({
    resolve: () => ({
      status: 422,
      body: { error: { code: 'policy_violation', message: 'refund_amount exceeds what is left on the deal' } },
    }),
  });
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'partial_refund', refundAmount: 100, note: 'x' }, ADMIN, deps)
    );
    assertEquals(e.code, 'payhold_refused');
    assertEquals(e.status, 422);
    const r = rows.get('dsp-1')!;
    assertEquals(r.resolution, null);
    assertEquals(r.decided_by, null);
    assertEquals(r.resolved_at, null);
  } finally {
    ph.restore();
  }
});

Deno.test('PayHold down keeps the decision for a retry, and says so', async () => {
  const { deps, rows } = setup();
  const ph = payhold({
    resolve: () => ({ status: 503, body: { error: { code: 'unavailable', message: 'down for maintenance' } } }),
  });
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'refund', note: 'Not as listed.' }, ADMIN, deps)
    );
    assertEquals(e.status, 502);
    assertEquals(e.code, 'payhold_unavailable');
    assertEquals(rows.get('dsp-1')!.resolution, 'refund');
    assertEquals(rows.get('dsp-1')!.status, 'under_review');
  } finally {
    ph.restore();
  }
});

Deno.test('a dispute with no PayHold case cannot be relayed', async () => {
  const mem = memoryStore([row({ id: 'dsp-1', booking_id: 'bk-1' })]);
  const deps = {
    store: mem.store,
    booking: () => Promise.resolve({ ...booking, payhold_deal_id: null }),
  };
  const ph = payhold();
  try {
    const e = await refusal(() =>
      resolveAdminDispute({ disputeId: 'dsp-1', resolution: 'release', note: 'x' }, ADMIN, deps)
    );
    assertEquals(e.code, 'no_payhold_case');
    assertEquals(ph.calls.length, 0);
  } finally {
    ph.restore();
  }
});

// ---------------------------------------------------------------------------
// GET ?id=
// ---------------------------------------------------------------------------

Deno.test('the detail links a blank case id by deal, backfills it, and speaks major units', async () => {
  const mem = memoryStore([row({ id: 'dsp-1', booking_id: 'bk-1', payhold_dispute_id: '' })]);
  const deps = { store: mem.store, booking: () => Promise.resolve(booking) };
  const ph = payhold({
    case: {
      disputed_amount: 15050,
      offers: [{
        id: 'of-1', dispute_id: 'ph-1', deal_id: 'deal-1', offered_by: 'seller', offered_by_actor: null,
        kind: 'partial_refund', amount: 2500, extend_to: null, note: null, status: 'open',
        expires_at: null, created_at: '2026-09-03T00:00:00Z', responded_at: null, responded_by_actor: null,
      }],
      evidence: [{
        id: 'ev-1', dispute_id: 'ph-1', deal_id: 'deal-1', uploaded_by: 'buyer', uploaded_by_actor: null,
        kind: 'photo', description: 'Door', storage_ref: 'chat-files/door.jpg', captured_at: null,
        created_at: '2026-09-03T01:00:00Z',
      }],
      timeline: [{ at: '2026-09-02T10:00:00Z', kind: 'dispute_opened', actor: null, side: 'buyer', summary: 'Dented door', details: {} }],
    },
  });
  try {
    const out = await adminDisputeDetail('dsp-1', deps);
    assertEquals(ph.calls[0].path, '/disputes?deal_id=deal-1');
    assertEquals(mem.rows.get('dsp-1')!.payhold_dispute_id, 'ph-1');
    assertEquals(out.dispute.payholdDisputeId, 'ph-1');
    assertEquals(out.payhold, {
      id: 'ph-1',
      status: 'open',
      currency: 'USD',
      dealAmount: 200,
      disputedAmount: 150.5,
      reasonCode: 'damaged',
      raisedBy: 'buyer',
      offers: [{ id: 'of-1', kind: 'partial_refund', status: 'open', amount: 25, offeredBy: 'seller', createdAt: '2026-09-03T00:00:00Z' }],
      evidence: [{ id: 'ev-1', kind: 'photo', description: 'Door', reference: 'chat-files/door.jpg', uploadedBy: 'buyer', createdAt: '2026-09-03T01:00:00Z' }],
      timeline: [{ at: '2026-09-02T10:00:00Z', event: 'dispute_opened', actor: 'system', detail: 'Dented door' }],
    });
  } finally {
    ph.restore();
  }
});

Deno.test('a zero-decimal deal is shown as it is stored', async () => {
  const { deps } = setup();
  const ph = payhold({ deal: { amount: 50000, currency: 'RWF' }, case: { disputed_amount: null } });
  try {
    const out = await adminDisputeDetail('dsp-1', deps);
    assertEquals(out.payhold?.dealAmount, 50000);
    assertEquals(out.payhold?.disputedAmount, null);
  } finally {
    ph.restore();
  }
});

Deno.test('no PayHold link means payhold: null, and PayHold is not asked', async () => {
  const mem = memoryStore([row({ id: 'dsp-1', booking_id: 'bk-1' })]);
  const deps = { store: mem.store, booking: () => Promise.resolve({ ...booking, payhold_deal_id: null }) };
  const ph = payhold();
  try {
    const out = await adminDisputeDetail('dsp-1', deps);
    assertEquals(out.payhold, null);
    assertEquals(ph.calls.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('the detail catches up a decision PayHold executed that the webhook never delivered', async () => {
  const { deps, rows } = setup({ payhold_status: 'open' });
  const ph = payhold({ case: { status: 'resolved_refunded', resolved_at: '2026-09-04T00:00:00Z' } });
  try {
    const out = await adminDisputeDetail('dsp-1', deps);
    assertEquals(rows.get('dsp-1')!.status, 'resolved_renter');
    assertEquals(out.dispute.status, 'resolved_renter');
  } finally {
    ph.restore();
  }
});
