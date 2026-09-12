import { assert, assertEquals } from 'jsr:@std/assert@^1.0.0';
import type { HandlerDeps, HostProfile } from './account.ts';

// See payhold-sync-verification/sync.test.ts: payhold.ts reads its env at
// module scope, so it is imported only after the env is in place.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const { handlePayoutAccountRequest } = await import('./account.ts');

/**
 * A host's payout account is verified from AutoHire's admin only. What is
 * pinned here: only an admin gets in; the account is read from PayHold on the
 * server and a destination id from the client is never used; the verifier is
 * the session's admin; and each of PayHold's answers — including the old
 * PayHold's refusal during the deploy window — lands on its outcome.
 */

const ADMIN_ID = 'admin-1';
const ADMIN_ACTOR = 'autohire-admin:admin-1';
const NAMES: Record<string, string> = { 'admin-1': 'Ops Admin', 'admin-2': 'Second Admin' };

type Reply = { status: number; body: unknown };
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

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
    security_hold_until: '2026-09-12T10:00:00Z',
    created_at: '2026-09-09T10:00:00Z',
    ...overrides,
  };
}

const refusal = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message } },
});

interface Routes {
  /** `n` counts destination reads, from 0. */
  destinations?: (sellerId: string, n: number) => Reply;
  verify?: (sellerId: string, destinationId: string, body: Json) => Reply;
  capabilities?: (sellerId: string) => Reply;
  lookup?: (handle: string) => Reply;
}

function payhold(routes: Routes = {}) {
  const calls: { method: string; path: string; body: Json | null }[] = [];
  let reads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path: path + url.search, body });

    let reply: Reply;
    let m: RegExpMatchArray | null;
    if (method === 'POST' && (m = path.match(/^\/sellers\/([^/]+)\/destinations\/([^/]+)\/verify$/))) {
      const verify = routes.verify ??
        ((_s: string, d: string, b: Json) => ({
          status: 200,
          body: dest({
            id: d,
            verified_at: b.verified ? '2026-09-11T12:00:00Z' : null,
            reported_verifier: b.verified_by,
            verifier_source: 'platform_reported',
          }),
        }));
      reply = verify(decodeURIComponent(m[1]), decodeURIComponent(m[2]), body ?? {});
    } else if (method === 'GET' && (m = path.match(/^\/sellers\/([^/]+)\/destinations$/))) {
      const destinations = routes.destinations ?? (() => ({ status: 200, body: { destinations: [dest()] } }));
      reply = destinations(decodeURIComponent(m[1]), reads++);
    } else if (method === 'GET' && (m = path.match(/^\/sellers\/([^/]+)\/capabilities$/))) {
      const capabilities = routes.capabilities ??
        (() => ({
          status: 200,
          body: { can_receive_payouts: true, kyc_status: 'verified', reasons: [], route_reasons: [] },
        }));
      reply = capabilities(decodeURIComponent(m[1]));
    } else if (method === 'GET' && path === '/sellers' && routes.lookup) {
      reply = routes.lookup(url.searchParams.get('external_user_id') ?? '');
    } else {
      reply = refusal(599, 'unexpected', `unexpected ${method} ${path}`);
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
    verifies: () => calls.filter((c) => c.method === 'POST'),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function world(profiles: HostProfile[] = [{ id: 'host-1', payhold_seller_id: 'sel_1', payout_status: 'pending' }]) {
  const rows = new Map(profiles.map((p) => [p.id, { ...p }]));
  const links: { profileId: string; sellerId: string | null }[] = [];
  const statuses: { profileId: string; status: string }[] = [];
  const deps: HandlerDeps = {
    userIdForToken: (token) =>
      Promise.resolve(token === 'admin-token' ? ADMIN_ID : token === 'host-token' ? 'host-1' : null),
    roleOf: (userId) => Promise.resolve(userId === ADMIN_ID ? 'admin' : 'owner'),
    readProfile: (id) => Promise.resolve(rows.get(id) ?? null),
    profileName: (id) => Promise.resolve(NAMES[id] ?? null),
    writeSellerLink: (profileId, sellerId) => {
      links.push({ profileId, sellerId });
      return Promise.resolve();
    },
    writePayoutStatus: (profileId, status) => {
      statuses.push({ profileId, status });
      return Promise.resolve();
    },
  };
  return { deps, links, statuses };
}

function get(profileId: string, token = 'admin-token'): Request {
  return new Request(
    `https://fn.test/payhold-verify-destination?profileId=${encodeURIComponent(profileId)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
  );
}

function post(body: unknown, token = 'admin-token'): Request {
  return new Request('https://fn.test/payhold-verify-destination', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function send(req: Request, deps: HandlerDeps): Promise<{ status: number; body: Json }> {
  const res = await handlePayoutAccountRequest(req, deps);
  return { status: res.status, body: await res.json() };
}

Deno.test('only an admin can read or verify a payout account, and PayHold is never asked otherwise', async () => {
  const ph = payhold();
  try {
    const { deps } = world();
    assertEquals((await send(get('host-1', 'host-token'), deps)).status, 403);
    assertEquals((await send(post({ profileId: 'host-1', verified: true }, 'host-token'), deps)).status, 403);
    assertEquals((await send(post({ profileId: 'host-1', verified: true }, 'nobody'), deps)).status, 401);
    const noToken = new Request('https://fn.test/payhold-verify-destination?profileId=host-1');
    assertEquals((await send(noToken, deps)).status, 401);
    assertEquals(ph.calls.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('a profile with no PayHold seller has no account, and nothing is sent', async () => {
  const ph = payhold();
  try {
    const { deps } = world([{ id: 'host-1', payhold_seller_id: null, payout_status: 'none' }]);
    const read = await send(get('host-1'), deps);
    assertEquals(read, { status: 200, body: { account: null, reason: 'not_registered' } });
    const act = await send(post({ profileId: 'host-1', verified: true }), deps);
    assertEquals(act, { status: 200, body: { outcome: 'not_registered', account: null } });
    assertEquals(ph.calls.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('a seller with no payout account says so, and nothing is verified', async () => {
  const ph = payhold({ destinations: () => ({ status: 200, body: { destinations: [] } }) });
  try {
    const { deps } = world();
    assertEquals((await send(get('host-1'), deps)).body, { account: null, reason: 'no_destination' });
    assertEquals((await send(post({ profileId: 'host-1', verified: true }), deps)).body, {
      outcome: 'no_destination',
      account: null,
    });
    assertEquals(ph.verifies().length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('the account is the live primary, and a relayed verifier is named from the admin profile', async () => {
  const ph = payhold({
    destinations: (_s, n) => ({
      status: 200,
      body: {
        destinations: n === 0
          ? [
            dest({ id: 'dst_old', is_primary: false, archived_at: '2026-09-01T00:00:00Z' }),
            dest({ id: 'dst_other', is_primary: false }),
            dest({ id: 'dst_live', verified_at: '2026-09-10T09:00:00Z', reported_verifier: 'autohire-admin:admin-2' }),
          ]
          : [dest({ id: 'dst_first', is_primary: false, payout_provider: 'stripe_connect', reported_verifier: 'api_key:autohire' })],
      },
    }),
  });
  try {
    const { deps } = world();
    const { status, body } = await send(get('host-1'), deps);
    assertEquals(status, 200);
    assertEquals(body.reason, undefined);
    assertEquals(body.account, {
      destinationId: 'dst_live',
      sellerId: 'sel_1',
      maskedDestination: '••••4242',
      payoutProvider: 'flutterwave_momo',
      method: 'momo',
      country: 'RW',
      payoutCurrency: 'RWF',
      label: 'Mobile money · ••••4242',
      verifiedAt: '2026-09-10T09:00:00Z',
      securityHoldUntil: '2026-09-12T10:00:00Z',
      createdAt: '2026-09-09T10:00:00Z',
      reportedVerifier: 'autohire-admin:admin-2',
      verifierName: 'Second Admin',
    });

    // No primary marked: the first live row. A credential is not a person.
    const second = (await send(get('host-1'), deps)).body.account;
    assertEquals(second.destinationId, 'dst_first');
    assertEquals(second.method, 'stripe');
    assertEquals(second.reportedVerifier, 'api_key:autohire');
    assertEquals(second.verifierName, null);
  } finally {
    ph.restore();
  }
});

Deno.test('verifying relays the session admin, keeps the hold, and refreshes payout status', async () => {
  const ph = payhold();
  try {
    const { deps, statuses } = world();
    const { status, body } = await send(post({ profileId: 'host-1', verified: true }), deps);
    assertEquals(status, 200);
    assertEquals(body.outcome, 'verified');

    const [call] = ph.verifies();
    assertEquals(call.path, '/sellers/sel_1/destinations/dst_live/verify');
    assertEquals(call.body, { verified: true, verified_by: ADMIN_ACTOR });

    assertEquals(body.account.verifiedAt, '2026-09-11T12:00:00Z');
    assertEquals(body.account.reportedVerifier, ADMIN_ACTOR);
    assertEquals(body.account.verifierName, 'Ops Admin');
    // Verifying does not end the security hold.
    assertEquals(body.account.securityHoldUntil, '2026-09-12T10:00:00Z');
    assertEquals(statuses, [{ profileId: 'host-1', status: 'active' }]);
  } finally {
    ph.restore();
  }
});

Deno.test('un-verifying sends an explicit false', async () => {
  const ph = payhold({
    capabilities: () => ({
      status: 200,
      body: { can_receive_payouts: false, kyc_status: 'verified', reasons: ['x'], route_reasons: [] },
    }),
  });
  try {
    const { deps, statuses } = world([{ id: 'host-1', payhold_seller_id: 'sel_1', payout_status: 'active' }]);
    const { body } = await send(post({ profileId: 'host-1', verified: false }), deps);
    assertEquals(body.outcome, 'unverified');
    assertEquals(ph.verifies()[0].body, { verified: false, verified_by: ADMIN_ACTOR });
    assertEquals(statuses, [{ profileId: 'host-1', status: 'pending' }]);
  } finally {
    ph.restore();
  }
});

Deno.test('a destination id, seller id or verifier from the client is never used', async () => {
  const ph = payhold();
  try {
    const { deps } = world();
    const { body } = await send(
      post({
        profileId: 'host-1',
        verified: true,
        destinationId: 'dst_attacker',
        sellerId: 'sel_attacker',
        verified_by: 'api_key:autohire',
        verifiedBy: 'autohire-admin:someone-else',
      }),
      deps,
    );
    assertEquals(body.outcome, 'verified');
    const [call] = ph.verifies();
    assertEquals(call.path, '/sellers/sel_1/destinations/dst_live/verify');
    assertEquals(call.body, { verified: true, verified_by: ADMIN_ACTOR });
  } finally {
    ph.restore();
  }
});

Deno.test('a missing or non-boolean direction is refused before PayHold is asked', async () => {
  const ph = payhold();
  try {
    const { deps } = world();
    for (const verified of [undefined, 'true', 1, null]) {
      const { status, body } = await send(post({ profileId: 'host-1', verified }), deps);
      assertEquals(status, 400, String(verified));
      assertEquals(body.code, 'bad_request');
    }
    assertEquals((await send(post({ verified: true }), deps)).status, 400);
    assertEquals((await send(get(''), deps)).status, 400);
    assertEquals((await send(get('ghost'), deps)).status, 404);
    assertEquals(ph.calls.length, 0);
  } finally {
    ph.restore();
  }
});

Deno.test('relay switched off reads as not trusted yet, with the account unchanged', async () => {
  const ph = payhold({
    verify: () => refusal(422, 'destination_relay_off', 'Destination verification relay is off for this account'),
  });
  try {
    const { deps, statuses } = world();
    const { status, body } = await send(post({ profileId: 'host-1', verified: true }), deps);
    assertEquals(status, 200);
    assertEquals(body.outcome, 'not_trusted_yet');
    assertEquals(body.account.destinationId, 'dst_live');
    assertEquals(body.account.verifiedAt, null);
    assertEquals(ph.verifies().length, 1);
    assertEquals(statuses, []);
  } finally {
    ph.restore();
  }
});

Deno.test('the old PayHold refusing an API key on this route also reads as not trusted yet', async () => {
  const legacy: Reply[] = [
    refusal(422, 'policy_violation', "Verifying a payout destination is a person's decision and cannot be done with an API key"),
    refusal(403, 'forbidden', 'API keys cannot do this'),
    refusal(401, 'unauthorized', 'A dashboard session is required'),
  ];
  for (const reply of legacy) {
    const ph = payhold({ verify: () => reply });
    try {
      const { deps } = world();
      const { status, body } = await send(post({ profileId: 'host-1', verified: true }), deps);
      assertEquals(status, 200, String(reply.status));
      assertEquals(body.outcome, 'not_trusted_yet', String(reply.status));
    } finally {
      ph.restore();
    }
  }
});

Deno.test('a replaced account comes back as changed, with the new one to check', async () => {
  const ph = payhold({
    destinations: (_s, n) => ({
      status: 200,
      body: {
        destinations: [n === 0 ? dest() : dest({ id: 'dst_new', masked_destination: '••••9999' })],
      },
    }),
    verify: () => refusal(409, 'destination_archived', 'This destination was replaced'),
  });
  try {
    const { deps, statuses } = world();
    const { status, body } = await send(post({ profileId: 'host-1', verified: true }), deps);
    assertEquals(status, 200);
    assertEquals(body.outcome, 'changed');
    assertEquals(body.account.destinationId, 'dst_new');
    assertEquals(body.account.maskedDestination, '••••9999');
    assertEquals(body.account.verifiedAt, null);
    // Not re-sent against the new account: the admin has not seen it yet.
    assertEquals(ph.verifies().length, 1);
    assertEquals(statuses, []);
  } finally {
    ph.restore();
  }
});

Deno.test('any other refusal is an error carrying PayHold words, never a quiet outcome', async () => {
  const cases: [Reply, number, string][] = [
    [refusal(400, 'invalid_request', 'verified_by is required'), 422, 'payhold_refused'],
    [refusal(409, 'invalid_state', 'something else'), 422, 'payhold_refused'],
    [refusal(503, 'unavailable', 'down for maintenance'), 502, 'payhold_unavailable'],
  ];
  for (const [reply, expectedStatus, code] of cases) {
    const ph = payhold({ verify: () => reply });
    try {
      const { deps, statuses } = world();
      const { status, body } = await send(post({ profileId: 'host-1', verified: true }), deps);
      assertEquals(status, expectedStatus, reply.body as never);
      assertEquals(body.code, code);
      assert(String(body.error).includes((reply.body as Json).error.message));
      assertEquals(statuses, []);
    } finally {
      ph.restore();
    }
  }
});

Deno.test('a stale seller link is re-linked by handle before the account is read', async () => {
  const ph = payhold({
    destinations: (sellerId) =>
      sellerId === 'sel_old'
        ? refusal(404, 'not_found', 'Seller sel_old not found')
        : { status: 200, body: { destinations: [dest()] } },
    lookup: (handle) => ({ status: 200, body: { sellers: [{ id: 'sel_new', external_user_id: handle }] } }),
  });
  try {
    const { deps, links } = world([{ id: 'host-1', payhold_seller_id: 'sel_old', payout_status: 'pending' }]);
    const { body } = await send(get('host-1'), deps);
    assertEquals(body.account.sellerId, 'sel_new');
    assertEquals(links, [{ profileId: 'host-1', sellerId: 'sel_new' }]);
  } finally {
    ph.restore();
  }
});

Deno.test('a stale seller link with nobody under the handle is cleared and reads as not registered', async () => {
  const ph = payhold({
    destinations: () => refusal(404, 'not_found', 'Seller sel_old not found'),
    lookup: () => ({ status: 200, body: { sellers: [] } }),
  });
  try {
    const { deps, links } = world([{ id: 'host-1', payhold_seller_id: 'sel_old', payout_status: 'pending' }]);
    const { body } = await send(post({ profileId: 'host-1', verified: true }), deps);
    assertEquals(body, { outcome: 'not_registered', account: null });
    assertEquals(links, [{ profileId: 'host-1', sellerId: null }]);
    assertEquals(ph.verifies().length, 0);
  } finally {
    ph.restore();
  }
});
