import { assertEquals } from 'jsr:@std/assert@^1.0.0';
import type { AutoVerifySettings, CandidateHost, SweepDeps } from './sweep.ts';

// See payhold-verify-destination/account.test.ts: payhold.ts reads its env at
// module scope, so it is imported only after the env is in place.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const { runAutoVerifySweep } = await import('./sweep.ts');

/**
 * What is pinned here: the wait is measured from PayHold's `created_at` and
 * nothing else; an account still inside the wait is not verified; the verifier
 * names the rule and never a person; the security hold is never touched; and
 * the sweep stops the moment PayHold says it does not take our decisions.
 */

const NOW = new Date('2026-09-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
type Reply = { status: number; body: unknown };

function dest(overrides: Json = {}): Json {
  return {
    id: 'dst_live',
    label: 'Mobile money · ••••4242',
    country: 'RW',
    payout_currency: 'RWF',
    payout_provider: 'flutterwave_momo',
    masked_destination: '••••4242',
    is_primary: true,
    is_backup: false,
    verified_at: null,
    security_hold_until: hoursAgo(1),
    created_at: hoursAgo(100),
    ...overrides,
  };
}

interface Routes {
  destinations?: (sellerId: string) => Reply;
  verify?: (sellerId: string, destinationId: string, body: Json) => Reply;
  capabilities?: (sellerId: string) => Reply;
}

function payhold(routes: Routes = {}) {
  const calls: { method: string; path: string; body: Json | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: url.pathname, body });

    const seller = url.pathname.match(/\/sellers\/([^/]+)/)?.[1] ?? '';
    let reply: Reply = { status: 404, body: { error: { code: 'not_found', message: 'no route' } } };

    if (method === 'GET' && url.pathname.endsWith('/destinations')) {
      reply = routes.destinations?.(seller) ?? { status: 200, body: { destinations: [dest()] } };
    } else if (method === 'GET' && url.pathname.endsWith('/capabilities')) {
      reply = routes.capabilities?.(seller) ??
        { status: 200, body: { can_receive_payouts: true, reasons: [] } };
    } else if (method === 'POST' && url.pathname.endsWith('/verify')) {
      const destinationId = url.pathname.split('/destinations/')[1]?.split('/')[0] ?? '';
      reply = routes.verify?.(seller, destinationId, body ?? {}) ??
        { status: 200, body: dest({ verified_at: NOW.toISOString() }) };
    }

    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

interface Harness {
  deps: SweepDeps;
  statuses: { profileId: string; status: string }[];
  runs: { at: Date; verified: number }[];
  notices: { profileId: string; title: string; body: string }[];
}

function harness(
  hosts: CandidateHost[],
  settings: Partial<AutoVerifySettings> = {},
): Harness {
  const statuses: Harness['statuses'] = [];
  const runs: Harness['runs'] = [];
  const notices: Harness['notices'] = [];
  return {
    statuses,
    runs,
    notices,
    deps: {
      readSettings: () =>
        Promise.resolve({ afterHours: 72, lastRunAt: null, ...settings }),
      candidates: () => Promise.resolve(hosts),
      writePayoutStatus: (profileId, status) => {
        statuses.push({ profileId, status });
        return Promise.resolve();
      },
      notifyHost: (profileId, title, body) => {
        notices.push({ profileId, title, body });
        return Promise.resolve();
      },
      markRun: (at, verified) => {
        runs.push({ at, verified });
        return Promise.resolve();
      },
      now: () => NOW,
    },
  };
}

const host = (id = 'p1', sellerId = 'sel_1'): CandidateHost => ({
  id,
  sellerId,
  payoutStatus: 'pending',
});

Deno.test('an account past the wait is verified, and the rule signs it', async () => {
  const ph = payhold();
  const h = harness([host()]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals(r.verified, 1);
    assertEquals(r.waiting, 0);
    const verify = ph.calls.find((c) => c.path.endsWith('/verify'));
    assertEquals(verify?.body, { verified: true, verified_by: 'autohire-auto-verify:72h' });
    // Nothing in the call touches the hold: PayHold's is the only clock on it.
    assertEquals(JSON.stringify(verify?.body).includes('hold'), false);
    assertEquals(h.runs, [{ at: NOW, verified: 1 }]);
  } finally {
    ph.restore();
  }
});

Deno.test('an account still inside the wait is left alone', async () => {
  const ph = payhold({
    destinations: () => ({ status: 200, body: { destinations: [dest({ created_at: hoursAgo(71) })] } }),
  });
  const h = harness([host()]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.verified, r.waiting], [0, 1]);
    assertEquals(ph.calls.some((c) => c.path.endsWith('/verify')), false);
  } finally {
    ph.restore();
  }
});

Deno.test('the wait is measured from created_at, not from the security hold', async () => {
  // Added 100 hours ago and still held (an operator lengthened the hold): the
  // wait is over, so it verifies — and PayHold still will not pay it until the
  // hold ends, which is the division of labour this depends on.
  const ph = payhold({
    destinations: () => ({
      status: 200,
      body: { destinations: [dest({ security_hold_until: '2026-09-13T00:00:00Z' })] },
    }),
  });
  const h = harness([host()]);
  try {
    assertEquals((await runAutoVerifySweep(h.deps)).verified, 1);
  } finally {
    ph.restore();
  }
});

Deno.test('an account with no created_at is left for an admin', async () => {
  const ph = payhold({
    destinations: () => ({ status: 200, body: { destinations: [dest({ created_at: null })] } }),
  });
  const h = harness([host()]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.verified, r.unknownAge], [0, 1]);
  } finally {
    ph.restore();
  }
});

Deno.test('an already verified account is not re-verified, and its status is reconciled', async () => {
  const ph = payhold({
    destinations: () => ({
      status: 200,
      body: { destinations: [dest({ verified_at: hoursAgo(2) })] },
    }),
  });
  const h = harness([host()]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.verified, r.already], [0, 1]);
    assertEquals(ph.calls.some((c) => c.path.endsWith('/verify')), false);
    assertEquals(h.statuses, [{ profileId: 'p1', status: 'active' }]);
  } finally {
    ph.restore();
  }
});

Deno.test('a verified account still in its hold is not asked about again', async () => {
  const ph = payhold({
    destinations: () => ({
      status: 200,
      body: {
        destinations: [dest({ verified_at: hoursAgo(2), security_hold_until: '2026-09-13T00:00:00Z' })],
      },
    }),
  });
  const h = harness([host()]);
  try {
    await runAutoVerifySweep(h.deps);
    assertEquals(ph.calls.some((c) => c.path.endsWith('/capabilities')), false);
    assertEquals(h.statuses, []);
  } finally {
    ph.restore();
  }
});

Deno.test('an archived destination has just been replaced, so the new one starts its own wait', async () => {
  const ph = payhold({
    verify: () => ({
      status: 409,
      body: { error: { code: 'destination_archived', message: 'replaced' } },
    }),
  });
  const h = harness([host()]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.verified, r.waiting, r.failed], [0, 1, 0]);
  } finally {
    ph.restore();
  }
});

Deno.test('the relay being off stops the whole sweep', async () => {
  const ph = payhold({
    verify: () => ({
      status: 422,
      body: { error: { code: 'destination_relay_off', message: 'not yours to verify' } },
    }),
  });
  const h = harness([host('p1', 'sel_1'), host('p2', 'sel_2'), host('p3', 'sel_3')]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.relayOff, r.checked, r.verified], [true, 1, 0]);
    assertEquals(ph.calls.filter((c) => c.path.endsWith('/verify')).length, 1);
  } finally {
    ph.restore();
  }
});

Deno.test('one host failing does not stop the next', async () => {
  const ph = payhold({
    destinations: (seller) =>
      seller === 'sel_1'
        ? { status: 500, body: { error: { code: 'server_error', message: 'boom' } } }
        : { status: 200, body: { destinations: [dest()] } },
  });
  const h = harness([host('p1', 'sel_1'), host('p2', 'sel_2')]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.checked, r.failed, r.verified], [2, 1, 1]);
  } finally {
    ph.restore();
  }
});

Deno.test('a seller PayHold no longer has is skipped, not repaired from here', async () => {
  const ph = payhold({
    destinations: () => ({
      status: 404,
      body: { error: { code: 'not_found', message: 'seller sel_1 not found' } },
    }),
  });
  const h = harness([host()]);
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.noAccount, r.failed], [1, 0]);
    assertEquals(h.statuses, []);
  } finally {
    ph.restore();
  }
});

Deno.test('nothing runs while the setting is off, and nothing is stamped', async () => {
  const ph = payhold();
  const h = harness([host()], { afterHours: 0 });
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.ran, r.reason], [false, 'off']);
    assertEquals(ph.calls.length, 0);
    assertEquals(h.runs.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('a second call inside five minutes does nothing', async () => {
  const ph = payhold();
  const h = harness([host()], { lastRunAt: new Date(NOW.getTime() - 60_000).toISOString() });
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.ran, r.reason], [false, 'too_soon']);
    assertEquals(ph.calls.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('a run six minutes after the last one goes ahead', async () => {
  const ph = payhold();
  const h = harness([host()], { lastRunAt: new Date(NOW.getTime() - 6 * 60_000).toISOString() });
  try {
    assertEquals((await runAutoVerifySweep(h.deps)).verified, 1);
  } finally {
    ph.restore();
  }
});

Deno.test('the host is told, and the wording follows whether they can be paid yet', async () => {
  const ph = payhold();
  const h = harness([host()]);
  try {
    await runAutoVerifySweep(h.deps);
    assertEquals(h.notices.length, 1);
    assertEquals(h.notices[0].profileId, 'p1');
    assertEquals(h.notices[0].body.includes('can be paid out from now on'), true);
  } finally {
    ph.restore();
  }
});

Deno.test('a host still inside the security hold is not promised money', async () => {
  const ph = payhold({
    destinations: () => ({
      status: 200,
      body: { destinations: [dest({ security_hold_until: '2026-09-13T00:00:00Z' })] },
    }),
    capabilities: () => ({ status: 200, body: { can_receive_payouts: false, reasons: ['hold'] } }),
  });
  const h = harness([host()]);
  try {
    await runAutoVerifySweep(h.deps);
    assertEquals(h.notices[0].body.includes('security hold'), true);
    assertEquals(h.notices[0].body.includes('from now on'), false);
  } finally {
    ph.restore();
  }
});

Deno.test('a failed notification never fails the run', async () => {
  const ph = payhold();
  const h = harness([host()]);
  h.deps.notifyHost = () => Promise.reject(new Error('bell is down'));
  try {
    const r = await runAutoVerifySweep(h.deps);
    assertEquals([r.verified, r.failed], [1, 0]);
  } finally {
    ph.restore();
  }
});

Deno.test('nobody is told when an admin had already verified it', async () => {
  const ph = payhold({
    destinations: () => ({ status: 200, body: { destinations: [dest({ verified_at: hoursAgo(2) })] } }),
  });
  const h = harness([host()]);
  try {
    await runAutoVerifySweep(h.deps);
    assertEquals(h.notices, []);
  } finally {
    ph.restore();
  }
});
