import { assertEquals } from 'jsr:@std/assert@^1.0.0';

// `payhold.ts` reads PAYHOLD_BASE_URL and PAYHOLD_API_KEY at module scope, and
// static imports are hoisted above this file's body — so a plain import would
// load it before these are set and every call would refuse with "PayHold is not
// configured", letting the suite pass for the wrong reason. Hence the dynamic
// import after the env is in place.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const { relayVerification } = await import('./sync.ts');

/**
 * The relay tells PayHold what `profiles.verification` stores, names the admin
 * who decided, and reports PayHold's answer without ever making the AutoHire
 * decision look failed.
 *
 * Everything here runs over a stubbed `fetch`, because the things most worth
 * pinning are wire-level: that `verified` is sent explicitly (PayHold reads a
 * missing field as `true`, so an un-verify that dropped the body would verify
 * instead), that `verified_by` travels with it, and which 404 licenses
 * repairing a stale seller link.
 */

/** What `index.ts` builds from the admin's session. */
const ADMIN = 'autohire-admin:profile-admin-1';

type Reply = { status: number; body: unknown };

function stubPayhold(routes: {
  verify: (sellerId: string) => Reply;
  lookup?: (handle: string) => Reply;
}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '') + url.search;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });

    let reply: Reply;
    const verify = path.match(/^\/sellers\/([^/?]+)\/verify$/);
    if (method === 'POST' && verify) {
      reply = routes.verify(decodeURIComponent(verify[1]));
    } else if (method === 'GET' && url.pathname.endsWith('/sellers') && routes.lookup) {
      reply = routes.lookup(url.searchParams.get('external_user_id') ?? '');
    } else {
      reply = { status: 599, body: { message: `unexpected ${method} ${path}` } };
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

const ok = (id: string): Reply => ({ status: 200, body: { id, external_user_id: 'p1' } });
const relayOff: Reply = {
  status: 422,
  body: { error: { code: 'verification_relay_off', message: 'Seller verification relay is off for this account' } },
};
/** The PayHold before `platform_owns_verification`. */
const legacyRelayRefused: Reply = {
  status: 422,
  body: {
    error: {
      code: 'policy_violation',
      message: "Verifying a seller is a person's decision and cannot be done with an API key",
    },
  },
};
const sellerGone = (id: string): Reply => ({
  status: 404,
  body: { error: { code: 'not_found', message: `Seller ${id} not found` } },
});

function links() {
  const written: { profileId: string; sellerId: string | null }[] = [];
  return {
    written,
    deps: {
      writeSellerLink: (profileId: string, sellerId: string | null) => {
        written.push({ profileId, sellerId });
        return Promise.resolve();
      },
    },
  };
}

Deno.test('a person with no PayHold seller is left alone, and nothing is sent', async () => {
  const { calls, restore } = stubPayhold({ verify: ok });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: null },
      ADMIN,
      links().deps,
    );
    assertEquals(r.payhold, 'not_registered');
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test('a verified person is relayed as verified: true, named by the admin who decided', async () => {
  const { calls, restore } = stubPayhold({ verify: ok });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      ADMIN,
      links().deps,
    );
    assertEquals(r.payhold, 'verified');
    assertEquals(calls[0].path, '/sellers/sel_1/verify');
    assertEquals(calls[0].body, { verified: true, verified_by: ADMIN });
  } finally {
    restore();
  }
});

Deno.test('anything short of verified is sent as an explicit false, never an empty body', async () => {
  // PayHold reads a missing `verified` as true. An un-verify that forgot the
  // body would verify the person it was meant to withdraw.
  for (const verification of ['pending', 'rejected', 'unverified']) {
    const { calls, restore } = stubPayhold({ verify: ok });
    try {
      const r = await relayVerification(
        { id: 'p1', verification, payhold_seller_id: 'sel_1' },
        ADMIN,
        links().deps,
      );
      assertEquals(r.payhold, 'unverified', verification);
      assertEquals(calls[0].body, { verified: false, verified_by: ADMIN }, verification);
    } finally {
      restore();
    }
  }
});

Deno.test('a relay with no verifier sends nothing and is reported as failed', async () => {
  // PayHold requires `verified_by`; so does the client, before the round trip.
  const { calls, restore } = stubPayhold({ verify: ok });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      '  ',
      links().deps,
    );
    assertEquals(r.payhold, 'failed');
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test('relay switched off in PayHold reads as not trusted yet, and is not retried', async () => {
  const { calls, restore } = stubPayhold({ verify: () => relayOff });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      ADMIN,
      links().deps,
    );
    assertEquals(r.payhold, 'not_trusted_yet');
    assertEquals(calls.length, 1);
  } finally {
    restore();
  }
});

Deno.test('the old PayHold refusal wording still reads as not trusted yet during the deploy window', async () => {
  const { calls, restore } = stubPayhold({ verify: () => legacyRelayRefused });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      ADMIN,
      links().deps,
    );
    assertEquals(r.payhold, 'not_trusted_yet');
    assertEquals(calls.length, 1);
  } finally {
    restore();
  }
});

Deno.test('a different policy refusal is a failure, not "turn on a setting"', async () => {
  // `policy_violation` also means a duplicate handle or an unroutable
  // destination. Only `verification_relay_off` (or the old person's-decision
  // wording) means relay is off.
  const { restore } = stubPayhold({
    verify: () => ({
      status: 422,
      body: { error: { code: 'policy_violation', message: 'external_user_id already in use' } },
    }),
  });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      ADMIN,
      links().deps,
    );
    assertEquals(r.payhold, 'failed');
  } finally {
    restore();
  }
});

Deno.test('a vanished seller is re-linked by handle, then relayed', async () => {
  const { written, deps } = links();
  const { calls, restore } = stubPayhold({
    verify: (id) => (id === 'sel_old' ? sellerGone(id) : ok(id)),
    lookup: (handle) => ({
      status: 200,
      body: { sellers: [{ id: 'sel_new', external_user_id: handle }] },
    }),
  });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_old' },
      ADMIN,
      deps,
    );
    assertEquals(r.payhold, 'verified');
    assertEquals(r.relinked, true);
    assertEquals(r.sellerId, 'sel_new');
    assertEquals(written, [{ profileId: 'p1', sellerId: 'sel_new' }]);
    assertEquals(calls.at(-1)?.path, '/sellers/sel_new/verify');
    assertEquals(calls.at(-1)?.body, { verified: true, verified_by: ADMIN });
  } finally {
    restore();
  }
});

Deno.test('a vanished seller with nobody under the handle clears the link', async () => {
  const { written, deps } = links();
  const { restore } = stubPayhold({
    verify: sellerGone,
    lookup: () => ({ status: 200, body: { sellers: [] } }),
  });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_old' },
      ADMIN,
      deps,
    );
    assertEquals(r.payhold, 'not_registered');
    assertEquals(r.staleLinkCleared, true);
    assertEquals(written, [{ profileId: 'p1', sellerId: null }]);
  } finally {
    restore();
  }
});

Deno.test('a route 404 is a failure and never unlinks anyone', async () => {
  // PayHold's router echoes the path it could not match, so this is a 404
  // containing "sellers" that says nothing about this seller existing.
  const { written, deps } = links();
  const { restore } = stubPayhold({
    verify: (id) => ({
      status: 404,
      body: { error: { code: 'unknown_route', message: `POST /sellers/${id}/verify is not a route` } },
    }),
  });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      ADMIN,
      deps,
    );
    assertEquals(r.payhold, 'failed');
    assertEquals(written, []);
  } finally {
    restore();
  }
});

Deno.test('PayHold being down is reported, not thrown', async () => {
  const { restore } = stubPayhold({
    verify: () => ({ status: 503, body: { error: { code: 'unavailable', message: 'down for maintenance' } } }),
  });
  try {
    const r = await relayVerification(
      { id: 'p1', verification: 'verified', payhold_seller_id: 'sel_1' },
      ADMIN,
      links().deps,
    );
    assertEquals(r.payhold, 'failed');
    assertEquals(r.error, 'down for maintenance');
  } finally {
    restore();
  }
});
