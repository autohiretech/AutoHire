import { assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.0';
import { memoryStore, row } from './memory-store.ts';

// `payhold.ts` reads PAYHOLD_BASE_URL / PAYHOLD_API_KEY at module scope, and
// static imports are hoisted — so these are set first and the modules that
// reach it are imported dynamically. See payhold-wire.test.ts.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const {
  PayHoldError,
  isDisputeAlreadyResolved,
  isDisputeRelayOff,
  listDisputes,
  localDisputeStatus,
  resolutionForPayholdStatus,
  resolveDispute,
} = await import('../payhold.ts');
const { mirrorDisputeOpened, mirrorDisputeResolved } = await import('../dispute-mirror.ts');

/**
 * The dispute mirror — what `payhold-webhook` does with `dispute.opened`,
 * `dispute.resolved` and the legacy `deal.dispute_resolved` — plus the PayHold
 * client calls and status mapping it and `payhold-dispute` stand on.
 *
 * The webhook's first version of `dispute.opened` read `data.dispute_id` from a
 * payload that was `{}` and stored `''`, named the renter as raiser whatever
 * PayHold said, and matched a booking's dispute without looking at its status.
 * Each of those has a test below.
 */

type Reply = { status: number; body: unknown };

function stubPayhold(route: (method: string, path: string, body: unknown) => Reply | undefined) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '') + url.search;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });
    const reply = route(method, path, body) ??
      { status: 599, body: { error: { code: 'unexpected', message: `unexpected ${method} ${path}` } } };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// deno-lint-ignore no-explicit-any
function phCase(overrides: Record<string, any> = {}) {
  return {
    id: 'ph-1',
    deal_id: 'deal-1',
    raised_by: 'buyer',
    raised_by_actor: null,
    reason: 'The car came back with a dented door.',
    reason_code: 'damaged',
    disputed_amount: 5000,
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

/** PayHold answering for a set of cases, by id and by deal. */
// deno-lint-ignore no-explicit-any
function casesRoute(cases: Record<string, any>[]) {
  return (method: string, path: string): Reply | undefined => {
    if (method !== 'GET') return undefined;
    const one = path.match(/^\/disputes\/([^/?]+)$/);
    if (one) {
      const found = cases.find((c) => c.id === decodeURIComponent(one[1]));
      return found
        ? { status: 200, body: found }
        : { status: 404, body: { error: { code: 'not_found', message: `Dispute ${one[1]} not found` } } };
    }
    if (path.startsWith('/disputes')) {
      const dealId = new URL(`https://x${path}`).searchParams.get('deal_id');
      return { status: 200, body: { disputes: cases.filter((c) => !dealId || c.deal_id === dealId) } };
    }
    return undefined;
  };
}

const booking = {
  id: 'bk-1',
  renter_id: 'renter-1',
  host_id: 'host-1',
  total_rwf: 200,
  charge_currency: 'USD',
  payhold_deal_id: 'deal-1',
};
const deal = { id: 'deal-1', currency: 'USD', amounts: null };

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

Deno.test('PayHold statuses map onto AutoHire statuses', () => {
  assertEquals(localDisputeStatus('resolved_released'), 'resolved_host');
  assertEquals(localDisputeStatus('resolved_refunded'), 'resolved_renter');
  assertEquals(localDisputeStatus('resolved_split'), 'resolved_split');
  assertEquals(localDisputeStatus('open'), 'open');
  assertEquals(localDisputeStatus('open', 'open'), 'open');
});

Deno.test('an open case keeps a local under_review, and nothing else', () => {
  assertEquals(localDisputeStatus('open', 'under_review'), 'under_review');
  // A locally-resolved row whose PayHold case is still open is not resolved:
  // the money is still frozen.
  assertEquals(localDisputeStatus('open', 'resolved_host'), 'open');
  // A decision always wins over under_review.
  assertEquals(localDisputeStatus('resolved_split', 'under_review'), 'resolved_split');
});

Deno.test('a status PayHold adds later leaves ours alone rather than guessing a winner', () => {
  assertEquals(localDisputeStatus('escalated', 'under_review'), 'under_review');
  assertEquals(localDisputeStatus('escalated'), 'open');
});

Deno.test('resolved statuses name their decision; open names none', () => {
  assertEquals(resolutionForPayholdStatus('resolved_released'), 'release');
  assertEquals(resolutionForPayholdStatus('resolved_refunded'), 'refund');
  assertEquals(resolutionForPayholdStatus('resolved_split'), 'partial_refund');
  assertEquals(resolutionForPayholdStatus('open'), null);
});

// ---------------------------------------------------------------------------
// Refusal matchers
// ---------------------------------------------------------------------------

Deno.test('relay-off is any 422 that mentions the relay or a setting, by code or words', () => {
  assertEquals(isDisputeRelayOff(new PayHoldError('Turn it on first', 422, 'dispute_relay_off')), true);
  assertEquals(
    isDisputeRelayOff(
      new PayHoldError('Deciding disputes by API key needs the dispute_decision_relay setting', 422, 'policy_violation'),
    ),
    true,
  );
  assertEquals(isDisputeRelayOff(new PayHoldError('refund_amount exceeds the deal', 422, 'policy_violation')), false);
  assertEquals(isDisputeRelayOff(new PayHoldError('relay is off', 409, 'dispute_relay_off')), false);
  assertEquals(isDisputeRelayOff(new Error('relay setting')), false);
});

Deno.test('already-resolved is a 409 that says so', () => {
  assertEquals(isDisputeAlreadyResolved(new PayHoldError('Resolved differently', 409, 'dispute_already_resolved')), true);
  assertEquals(isDisputeAlreadyResolved(new PayHoldError('Dispute is already resolved', 409, 'invalid_state')), true);
  assertEquals(isDisputeAlreadyResolved(new PayHoldError('Deal is paid_out', 409, 'invalid_state')), false);
});

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

Deno.test('resolve sends the decision, the note and the decider — and a refund amount only for a split', async () => {
  const { calls, restore } = stubPayhold(() => ({ status: 200, body: phCase({ status: 'resolved_released' }) }));
  try {
    await resolveDispute('ph-1', {
      resolution: 'release',
      note: 'Photos show the dent was there at pickup.',
      refundAmount: 999,
      decidedBy: 'autohire-admin:ops@example.com',
    });
    assertEquals(calls[0].method, 'POST');
    assertEquals(calls[0].path, '/disputes/ph-1/resolve');
    assertEquals(calls[0].body, {
      resolution: 'release',
      note: 'Photos show the dent was there at pickup.',
      decided_by: 'autohire-admin:ops@example.com',
    });

    await resolveDispute('ph-1', {
      resolution: 'partial_refund',
      note: 'Half the repair.',
      refundAmount: 2500,
      decidedBy: 'autohire-admin:ops@example.com',
    });
    assertEquals(calls[1].body, {
      resolution: 'partial_refund',
      note: 'Half the repair.',
      decided_by: 'autohire-admin:ops@example.com',
      refund_amount: 2500,
    });
  } finally {
    restore();
  }
});

Deno.test('a split with no whole refund amount never reaches PayHold', async () => {
  const { calls, restore } = stubPayhold(() => ({ status: 200, body: {} }));
  try {
    for (const refundAmount of [undefined, 0, 12.5]) {
      await assertRejects(() =>
        resolveDispute('ph-1', { resolution: 'partial_refund', note: 'x', refundAmount, decidedBy: 'a' })
      );
    }
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test('listDisputes asks for one deal and keeps only that deal, whatever the server did', async () => {
  const { calls, restore } = stubPayhold(() => ({
    status: 200,
    // A PayHold that ignored `deal_id` and returned the tenant's whole list.
    body: { disputes: [phCase({ id: 'other', deal_id: 'deal-9' }), phCase()] },
  }));
  try {
    const found = await listDisputes({ dealId: 'deal-1', status: 'open', limit: 5 });
    assertEquals(calls[0].path, '/disputes?deal_id=deal-1&status=open&limit=5');
    assertEquals(found.map((d) => d.id), ['ph-1']);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// dispute.opened
// ---------------------------------------------------------------------------

Deno.test('dispute.opened by the seller names the HOST as raiser, with PayHold\'s figures', async () => {
  const { store, rows } = memoryStore();
  const { restore } = stubPayhold(casesRoute([phCase({ raised_by: 'seller', disputed_amount: 5000 })]));
  try {
    const out = await mirrorDisputeOpened(store, booking, deal, {
      dispute_id: 'ph-1',
      raised_by: 'seller',
      reason: 'x',
      reason_code: 'damaged',
      disputed_amount: 5000,
    });
    assertEquals(out.action, 'inserted');
    const r = [...rows.values()][0];
    assertEquals(r.payhold_dispute_id, 'ph-1');
    assertEquals(r.raised_by, 'host-1');
    assertEquals(r.against, 'renter-1');
    assertEquals(r.reason_code, 'damaged');
    assertEquals(r.disputed_amount_minor, 5000);
    assertEquals(r.currency, 'USD');
    assertEquals(r.amount_rwf, 50); // 5000 cents, in the booking's whole units
    assertEquals(r.status, 'open');
    assertEquals(r.payhold_status, 'open');
  } finally {
    restore();
  }
});

Deno.test('a legacy dispute.opened with {} finds the case by deal and never stores a blank id', async () => {
  const { store, rows } = memoryStore();
  const { calls, restore } = stubPayhold(casesRoute([
    phCase({ id: 'ph-old', status: 'resolved_released', opened_at: '2026-08-01T00:00:00Z' }),
    phCase({ id: 'ph-new', opened_at: '2026-09-03T00:00:00Z' }),
  ]));
  try {
    const out = await mirrorDisputeOpened(store, booking, deal, {});
    assertEquals(out.action, 'inserted');
    assertEquals(calls[0].path, '/disputes?deal_id=deal-1');
    const r = [...rows.values()][0];
    assertEquals(r.payhold_dispute_id, 'ph-new');
    assertEquals(r.raised_by, 'renter-1');
  } finally {
    restore();
  }
});

Deno.test('dispute.opened links the booking\'s open unlinked row instead of inserting a second', async () => {
  const { store, rows, writes } = memoryStore([
    // Raised in AutoHire by the host a moment before PayHold answered.
    row({ id: 'dsp-local', booking_id: 'bk-1', raised_by: 'host-1', against: 'renter-1' }),
  ]);
  const { restore } = stubPayhold(casesRoute([phCase({ raised_by: 'seller' })]));
  try {
    const out = await mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-1' });
    assertEquals(out.action, 'updated');
    assertEquals(rows.size, 1);
    assertEquals(rows.get('dsp-local')!.payhold_dispute_id, 'ph-1');
    assertEquals(rows.get('dsp-local')!.raised_by, 'host-1');
    assertEquals(writes.filter((w) => w.op === 'insert').length, 0);
  } finally {
    restore();
  }
});

Deno.test('dispute.opened never re-opens a resolved dispute on the same booking', async () => {
  const resolved = row({
    id: 'dsp-history',
    booking_id: 'bk-1',
    status: 'resolved_host',
    resolution: 'release',
    resolution_note: 'Decided last month.',
  });
  const { store, rows } = memoryStore([resolved]);
  const { restore } = stubPayhold(casesRoute([phCase({ id: 'ph-2' })]));
  try {
    const out = await mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-2' });
    assertEquals(out.action, 'inserted');
    assertEquals(rows.size, 2);
    assertEquals(rows.get('dsp-history'), resolved);
  } finally {
    restore();
  }
});

Deno.test('dispute.opened does not reuse an open row that belongs to a different case', async () => {
  const { store, rows } = memoryStore([
    row({ id: 'dsp-a', booking_id: 'bk-1', payhold_dispute_id: 'ph-a', payhold_status: 'open' }),
  ]);
  const { restore } = stubPayhold(casesRoute([phCase({ id: 'ph-b' })]));
  try {
    const out = await mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-b' });
    assertEquals(out.action, 'inserted');
    assertEquals(rows.get('dsp-a')!.payhold_dispute_id, 'ph-a');
  } finally {
    restore();
  }
});

Deno.test('a redelivered dispute.opened updates the row it made, and an admin\'s under_review stands', async () => {
  const { store, rows, writes } = memoryStore();
  const { restore } = stubPayhold(casesRoute([phCase()]));
  try {
    await mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-1' });
    const id = [...rows.keys()][0];
    await store.update(id, { status: 'under_review' });
    const again = await mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-1' });
    assertEquals(again.action, 'updated');
    assertEquals(rows.size, 1);
    assertEquals(rows.get(id)!.status, 'under_review');
    assertEquals(writes.filter((w) => w.op === 'insert').length, 1);
  } finally {
    restore();
  }
});

Deno.test('an event naming a case on another deal is not trusted for the id', async () => {
  const { store, rows } = memoryStore();
  const { restore } = stubPayhold(casesRoute([
    phCase({ id: 'ph-elsewhere', deal_id: 'deal-9' }),
    phCase({ id: 'ph-1' }),
  ]));
  try {
    await mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-elsewhere' });
    assertEquals([...rows.values()][0].payhold_dispute_id, 'ph-1');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// dispute.resolved / deal.dispute_resolved
// ---------------------------------------------------------------------------

Deno.test('dispute.resolved takes status and decision from PayHold\'s case', async () => {
  const { store, rows } = memoryStore([
    row({ id: 'dsp-1', booking_id: 'bk-1', payhold_dispute_id: 'ph-1', payhold_status: 'open' }),
  ]);
  const { restore } = stubPayhold(casesRoute([
    phCase({
      status: 'resolved_refunded',
      resolved_at: '2026-09-05T12:00:00Z',
      resolution_note: 'Car was not as listed.',
      decided_by: 'staff:jo@payhold.test',
    }),
  ]));
  try {
    const out = await mirrorDisputeResolved(store, booking, deal, {
      dispute_id: 'ph-1',
      status: 'resolved_refunded',
      decided_by: 'staff:jo@payhold.test',
    }, false);
    assertEquals(out.action, 'updated');
    const r = rows.get('dsp-1')!;
    assertEquals(r.status, 'resolved_renter');
    assertEquals(r.payhold_status, 'resolved_refunded');
    assertEquals(r.resolution, 'refund');
    assertEquals(r.refund_amount_minor, null);
    assertEquals(r.resolution_note, 'Car was not as listed.');
    assertEquals(r.decided_by, 'staff:jo@payhold.test');
    assertEquals(r.resolved_at, '2026-09-05T12:00:00Z');
  } finally {
    restore();
  }
});

Deno.test('a split decided in PayHold reads its refund from the deal ledger', async () => {
  const { store, rows } = memoryStore([
    row({ id: 'dsp-1', booking_id: 'bk-1', payhold_dispute_id: 'ph-1' }),
  ]);
  const { restore } = stubPayhold(casesRoute([
    phCase({ status: 'resolved_split', resolved_at: '2026-09-05T12:00:00Z' }),
  ]));
  try {
    const withLedger = {
      ...deal,
      amounts: {
        currency: 'USD', buyer_paid: 20000, platform_fee: 0, provider_fee: 0, tax: 0,
        reserve: 0, refunded: 3000, paid_out: 0, seller_net: 17000,
      },
    };
    await mirrorDisputeResolved(store, booking, withLedger, { dispute_id: 'ph-1' }, false);
    const r = rows.get('dsp-1')!;
    assertEquals(r.status, 'resolved_split');
    assertEquals(r.resolution, 'partial_refund');
    assertEquals(r.refund_amount_minor, 3000);
  } finally {
    restore();
  }
});

Deno.test('a split relayed from AutoHire keeps the amount the admin decided', async () => {
  const { store, rows } = memoryStore([
    row({
      id: 'dsp-1',
      booking_id: 'bk-1',
      payhold_dispute_id: 'ph-1',
      status: 'under_review',
      resolution: 'partial_refund',
      refund_amount_minor: 2500,
      currency: 'USD',
      resolution_note: 'Half the repair.',
      decided_by: 'autohire-admin:ops@example.com',
    }),
  ]);
  const { restore } = stubPayhold(casesRoute([
    phCase({ status: 'resolved_split', resolved_at: '2026-09-05T12:00:00Z', decided_by: null }),
  ]));
  try {
    await mirrorDisputeResolved(store, booking, deal, { dispute_id: 'ph-1' }, false);
    const r = rows.get('dsp-1')!;
    assertEquals(r.refund_amount_minor, 2500);
    assertEquals(r.decided_by, 'autohire-admin:ops@example.com');
    assertEquals(r.resolution_note, 'Half the repair.');
  } finally {
    restore();
  }
});

Deno.test('legacy deal.dispute_resolved is ignored once the row is resolved', async () => {
  const { store, writes } = memoryStore([
    row({
      id: 'dsp-1',
      booking_id: 'bk-1',
      payhold_dispute_id: 'ph-1',
      status: 'resolved_split',
      payhold_status: 'resolved_split',
      resolution: 'partial_refund',
      refund_amount_minor: 2500,
    }),
  ]);
  const { restore } = stubPayhold(casesRoute([phCase({ status: 'resolved_split' })]));
  try {
    // The legacy event calls a split `refund`.
    const out = await mirrorDisputeResolved(store, booking, deal, {
      dispute_id: 'ph-1',
      resolution: 'refund',
      note: 'x',
    }, true);
    assertEquals(out.action, 'skipped');
    assertEquals(writes.length, 0);
  } finally {
    restore();
  }
});

Deno.test('legacy deal.dispute_resolved still applies when dispute.resolved never came — as PayHold says, not as it says', async () => {
  const { store, rows } = memoryStore([
    row({ id: 'dsp-1', booking_id: 'bk-1', payhold_dispute_id: 'ph-1', payhold_status: 'open' }),
  ]);
  const { restore } = stubPayhold(casesRoute([
    phCase({ status: 'resolved_split', resolved_at: '2026-09-05T12:00:00Z' }),
  ]));
  try {
    const out = await mirrorDisputeResolved(store, booking, deal, {
      dispute_id: 'ph-1',
      resolution: 'refund',
    }, true);
    assertEquals(out.action, 'updated');
    assertEquals(rows.get('dsp-1')!.status, 'resolved_split');
    assertEquals(rows.get('dsp-1')!.resolution, 'partial_refund');
  } finally {
    restore();
  }
});

Deno.test('a resolution for a case never mirrored creates the row, already resolved', async () => {
  const { store, rows } = memoryStore();
  const { restore } = stubPayhold(casesRoute([
    phCase({ status: 'resolved_released', resolved_at: '2026-09-05T12:00:00Z' }),
  ]));
  try {
    const out = await mirrorDisputeResolved(store, booking, deal, { dispute_id: 'ph-1' }, false);
    assertEquals(out.action, 'inserted');
    const r = [...rows.values()][0];
    assertEquals(r.status, 'resolved_host');
    assertEquals(r.resolution, 'release');
  } finally {
    restore();
  }
});

Deno.test('PayHold unreachable while mirroring throws, so the webhook 500s and PayHold retries', async () => {
  const { store } = memoryStore();
  const { restore } = stubPayhold(() => ({
    status: 503,
    body: { error: { code: 'unavailable', message: 'down' } },
  }));
  try {
    await assertRejects(() => mirrorDisputeOpened(store, booking, deal, { dispute_id: 'ph-1' }));
  } finally {
    restore();
  }
});
