import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.0';

// See payhold-wire.test.ts: payhold.ts reads its env at module scope.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const {
  PayHoldError,
  autohireAdminActor,
  autohireAdminProfileId,
  isDestinationArchived,
  isDestinationRelayOff,
  isVerificationRelayRefused,
  setDestinationVerified,
  setSellerVerified,
} = await import('../payhold.ts');

/**
 * Verification of a seller and of a payout account comes only from AutoHire's
 * admin. Pinned here: `verified_by` always travels and is checked before the
 * round trip, `verified` is always explicit, and the refusal matchers take the
 * exact new codes first and the old PayHold's refusals only as a fallback.
 */

function captureFetch(reply: { status: number; body: unknown } = { status: 200, body: {} }) {
  const seen: { url: string; method: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

Deno.test('a seller verification carries verified_by beside an explicit verified', async () => {
  const { seen, restore } = captureFetch();
  try {
    await setSellerVerified('sel 1', false, ' autohire-admin:p1 ');
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel%201/verify');
    assertEquals(seen[0].method, 'POST');
    assertEquals(seen[0].body, { verified: false, verified_by: 'autohire-admin:p1' });
  } finally {
    restore();
  }
});

Deno.test('a destination verification goes to that destination, with verified_by', async () => {
  const { seen, restore } = captureFetch();
  try {
    await setDestinationVerified('sel_1', 'dst/1', true, 'autohire-admin:p1');
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel_1/destinations/dst%2F1/verify');
    assertEquals(seen[0].body, { verified: true, verified_by: 'autohire-admin:p1' });
  } finally {
    restore();
  }
});

Deno.test('a missing, oversized or API-key verifier is refused without a request', async () => {
  const { seen, restore } = captureFetch();
  try {
    for (const by of ['', '   ', 'api_key:autohire', 'x'.repeat(201)]) {
      await assertRejects(() => setSellerVerified('sel_1', true, by), PayHoldError);
      await assertRejects(() => setDestinationVerified('sel_1', 'dst_1', true, by), PayHoldError);
    }
    // A JS caller that forgot the direction must not reach PayHold, which reads it as true.
    // deno-lint-ignore no-explicit-any
    await assertRejects(() => setSellerVerified('sel_1', undefined as any, 'autohire-admin:p1'), PayHoldError);
    await assertRejects(() => setDestinationVerified('sel_1', '', true, 'autohire-admin:p1'), PayHoldError);
    assertEquals(seen.length, 0);
  } finally {
    restore();
  }
});

Deno.test('the autohire-admin actor round-trips and names nobody else', () => {
  assertEquals(autohireAdminActor('p1'), 'autohire-admin:p1');
  assertEquals(autohireAdminProfileId('autohire-admin:p1'), 'p1');
  assertEquals(autohireAdminProfileId('autohire-admin:'), null);
  assertEquals(autohireAdminProfileId('api_key:autohire'), null);
  assertEquals(autohireAdminProfileId(null), null);
});

Deno.test('seller relay refusal: the new code, then the legacy wording, and nothing else', () => {
  assert(isVerificationRelayRefused(new PayHoldError('off', 422, 'verification_relay_off')));
  assert(isVerificationRelayRefused(
    new PayHoldError("Verifying a seller is a person's decision and cannot be done with an API key", 422, 'policy_violation'),
  ));
  assert(!isVerificationRelayRefused(new PayHoldError('external_user_id already in use', 422, 'policy_violation')));
  assert(!isVerificationRelayRefused(new PayHoldError('owned', 409, 'verification_owned_by_platform')));
  assert(!isVerificationRelayRefused(new Error('verification_relay_off')));
});

Deno.test('destination relay off: the new code, then the old key refusal, never a 404, 409 or 5xx', () => {
  assert(isDestinationRelayOff(new PayHoldError('off', 422, 'destination_relay_off')));
  assert(isDestinationRelayOff(
    new PayHoldError("Verifying a payout destination is a person's decision", 422, 'policy_violation'),
  ));
  assert(isDestinationRelayOff(new PayHoldError('no', 403, 'forbidden')));
  assert(isDestinationRelayOff(new PayHoldError('no', 401, 'unauthorized')));
  assert(!isDestinationRelayOff(new PayHoldError('replaced', 409, 'destination_archived')));
  assert(!isDestinationRelayOff(new PayHoldError('Destination dst_1 not found', 404, 'not_found')));
  assert(!isDestinationRelayOff(new PayHoldError('down', 503, 'unavailable')));
  assert(!isDestinationRelayOff(new PayHoldError('verified_by is required', 400, 'invalid_request')));
});

Deno.test('archived is the exact 409 code', () => {
  assert(isDestinationArchived(new PayHoldError('replaced', 409, 'destination_archived')));
  assert(!isDestinationArchived(new PayHoldError('replaced', 409, 'invalid_state')));
  assert(!isDestinationArchived(new PayHoldError('replaced', 422, 'destination_archived')));
});
