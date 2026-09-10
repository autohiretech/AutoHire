import { assertEquals } from 'jsr:@std/assert@^1.0.0';

// `BASE_URL` and `API_KEY` are read at module scope in `payhold.ts`, and static
// imports are hoisted above everything else in this file — so a plain import
// would evaluate that module before these are set and every call would refuse
// with "PayHold is not configured". Hence the dynamic import.
Deno.env.set('PAYHOLD_BASE_URL', 'https://payhold.test/v1');
Deno.env.set('PAYHOLD_API_KEY', 'test-key');

const { payoutRouteFor, startConnectSession } = await import('../payhold.ts');

/**
 * What actually goes over the wire.
 *
 * These exist because the two most expensive mistakes in this integration were
 * both wire-format, not logic: `payout.methods` was read as a top-level
 * sibling when it is nested inside `payout` (which returns `undefined` in
 * silence and falls back to a stale inference), and `payout_currency` was
 * never sent at all — which is not an error anywhere, it just means PayHold
 * answers about a different currency than the host asked about.
 *
 * A stub `fetch` is the only way to assert either. Nothing here reaches a
 * network.
 */
function captureFetch() {
  const seen: { url: string; method: string; body: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ payout: { methods: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

Deno.test('a route lookup with no currency asks about the country alone', async () => {
  const { seen, restore } = captureFetch();
  try {
    await payoutRouteFor('KE');
    assertEquals(seen[0].url, 'https://payhold.test/v1/payment-options?payout_country=KE');
    assertEquals(seen[0].method, 'GET');
  } finally {
    restore();
  }
});

Deno.test('a currency is sent when asked for — the PayPal-in-Kenya case', async () => {
  // KE/KES routes mobile money and PayPal is correctly absent; KE/USD routes
  // PayPal. Before this parameter existed, AutoHire could only ask the first
  // question, which is why PayPal was unreachable in every African corridor.
  const { seen, restore } = captureFetch();
  try {
    await payoutRouteFor('KE', { currency: 'USD' });
    assertEquals(
      seen[0].url,
      'https://payhold.test/v1/payment-options?payout_country=KE&payout_currency=USD',
    );
  } finally {
    restore();
  }
});

Deno.test('currency and banks travel together without clobbering each other', async () => {
  const { seen, restore } = captureFetch();
  try {
    await payoutRouteFor('NG', { currency: 'USD', banks: true });
    assertEquals(
      seen[0].url,
      'https://payhold.test/v1/payment-options?payout_country=NG&payout_currency=USD&banks=1',
    );
  } finally {
    restore();
  }
});

Deno.test('a null currency is omitted rather than sent as the string "null"', async () => {
  const { seen, restore } = captureFetch();
  try {
    await payoutRouteFor('KE', { currency: null });
    assertEquals(seen[0].url, 'https://payhold.test/v1/payment-options?payout_country=KE');
  } finally {
    restore();
  }
});

Deno.test('a connect session POSTs to the seller and carries no cached state', async () => {
  const { seen, restore } = captureFetch();
  try {
    await startConnectSession('sel_123');
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel_123/connect/session');
    assertEquals(seen[0].method, 'POST');
    assertEquals(seen[0].body, '{}');
  } finally {
    restore();
  }
});

Deno.test('two session calls are two requests — the secret is never reused', async () => {
  // Connect.js re-invokes `fetchClientSecret` when a session expires
  // mid-onboarding. If anything memoised the first response, the host would be
  // handed a spent secret and stranded on the step they had reached.
  const { seen, restore } = captureFetch();
  try {
    await startConnectSession('sel_123');
    await startConnectSession('sel_123');
    assertEquals(seen.length, 2);
  } finally {
    restore();
  }
});

Deno.test('a seller id is escaped rather than concatenated', async () => {
  const { seen, restore } = captureFetch();
  try {
    await startConnectSession('sel/../admin');
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel%2F..%2Fadmin/connect/session');
  } finally {
    restore();
  }
});
