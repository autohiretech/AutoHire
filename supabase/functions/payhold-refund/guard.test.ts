import { assertEquals } from 'jsr:@std/assert@^1.0.0';

// See payhold-sync-verification/sync.test.ts: payhold.ts reads its env at
// module scope, so it is imported only after the env is in place.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const { disputeRefundGuard } = await import('./guard.ts');

/**
 * `payhold-refund` must not move money that is under dispute — the refund was
 * a way around Admin → Disputes. The PayHold half runs over a stubbed `fetch`
 * through the real `hasOpenDisputeOnDeal`, so the wire call is covered too.
 */

type Reply = { status: number; body: unknown };

function stubPayhold(reply: (path: string) => Reply) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '') + url.search;
    calls.push(path);
    const r = reply(path);
    return Promise.resolve(
      new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }),
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const booking = { id: 'bk-1', payhold_deal_id: 'deal-1' };
const noLocal = { hasActiveLocalDispute: () => Promise.resolve(false) };
const disputes = (list: Record<string, unknown>[]): Reply => ({ status: 200, body: { disputes: list } });

Deno.test('a local open or under_review dispute refuses with 409, without asking PayHold', async () => {
  const { calls, restore } = stubPayhold(() => disputes([]));
  try {
    const seen: string[] = [];
    const refusal = await disputeRefundGuard(booking, {
      hasActiveLocalDispute: (id) => {
        seen.push(id);
        return Promise.resolve(true);
      },
    });
    assertEquals(refusal?.status, 409);
    assertEquals(refusal?.body.code, 'under_dispute');
    assertEquals(refusal?.body.error, 'This booking is under dispute — decide it in Admin → Disputes.');
    assertEquals(seen, ['bk-1']);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test('an open PayHold case on the deal refuses with 409', async () => {
  // Opened in PayHold, webhook not landed yet — nothing local knows.
  const { calls, restore } = stubPayhold(() =>
    disputes([{ id: 'ph-1', deal_id: 'deal-1', status: 'open', opened_at: '2026-09-02T00:00:00Z' }])
  );
  try {
    const refusal = await disputeRefundGuard(booking, noLocal);
    assertEquals(refusal?.status, 409);
    assertEquals(refusal?.body.code, 'under_dispute');
    assertEquals(calls, ['/disputes?deal_id=deal-1&status=open&limit=5']);
  } finally {
    restore();
  }
});

Deno.test('PayHold unreachable fails closed with 502', async () => {
  const { restore } = stubPayhold(() => ({
    status: 503,
    body: { error: { code: 'unavailable', message: 'down for maintenance' } },
  }));
  try {
    const refusal = await disputeRefundGuard(booking, noLocal);
    assertEquals(refusal?.status, 502);
    assertEquals(refusal?.body.code, 'dispute_check_failed');
    assertEquals(refusal?.body.detail, 'down for maintenance');
  } finally {
    restore();
  }
});

Deno.test('no dispute anywhere lets the refund through', async () => {
  const { calls, restore } = stubPayhold(() => disputes([]));
  try {
    assertEquals(await disputeRefundGuard(booking, noLocal), null);
    assertEquals(calls.length, 1);
  } finally {
    restore();
  }
});

Deno.test('a resolved case, or another deal\'s open one, does not block the refund', async () => {
  // A PayHold that ignored both filters and returned the tenant's list.
  const { restore } = stubPayhold(() =>
    disputes([
      { id: 'ph-old', deal_id: 'deal-1', status: 'resolved_released', opened_at: '2026-08-01T00:00:00Z' },
      { id: 'ph-other', deal_id: 'deal-9', status: 'open', opened_at: '2026-09-02T00:00:00Z' },
    ])
  );
  try {
    assertEquals(await disputeRefundGuard(booking, noLocal), null);
  } finally {
    restore();
  }
});

Deno.test('a local read that fails refuses rather than refunding blind', async () => {
  const { calls, restore } = stubPayhold(() => disputes([]));
  try {
    const refusal = await disputeRefundGuard(booking, {
      hasActiveLocalDispute: () => Promise.reject(new Error('connection reset')),
    });
    assertEquals(refusal?.status, 500);
    assertEquals(refusal?.body.code, 'dispute_check_failed');
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});
