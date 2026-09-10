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
    await startConnectSession('sel_123', { country: 'US' });
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel_123/connect/session');
    assertEquals(seen[0].method, 'POST');
    // The country and nothing else — no secret, no cached session id.
    assertEquals(JSON.parse(seen[0].body ?? '{}'), { country: 'US' });
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
    await startConnectSession('sel_123', { country: 'US' });
    await startConnectSession('sel_123', { country: 'US' });
    assertEquals(seen.length, 2);
  } finally {
    restore();
  }
});

Deno.test('a seller id is escaped rather than concatenated', async () => {
  const { seen, restore } = captureFetch();
  try {
    await startConnectSession('sel/../admin', { country: 'US' });
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel%2F..%2Fadmin/connect/session');
  } finally {
    restore();
  }
});

/**
 * The country/currency pair, which is one fact sent as two fields.
 *
 * A host moved from Rwanda to the United States, changed their profile
 * country, and was refused with "paypal cannot pay a destination in RW".
 * AutoHire sent `country` only on a seller's *first* destination, so every
 * later change let PayHold fall back to `seller.country` — the country of the
 * first one. The move could be made in the profile and never completed at the
 * rail.
 *
 * Sending country alone is not the fix either: PayHold pairs a supplied
 * country with the *stored* currency, which is how "in RW … paid in RWF"
 * survives a move to the US. Both, every time, or neither is trustworthy.
 */
const { addSellerDestination } = await import('../payhold.ts');

Deno.test('a destination change states the country every time', async () => {
  const { seen, restore } = captureFetch();
  try {
    await addSellerDestination('sel_1', {
      payoutProvider: 'paypal',
      destination: 'host@example.com',
      country: 'US',
      currency: 'USD',
      label: 'PayPal',
    });
    const body = JSON.parse(seen[0].body ?? '{}');
    assertEquals(body.country, 'US');
    assertEquals(body.payout_currency, 'USD');
  } finally {
    restore();
  }
});

Deno.test('country and currency travel together, never one alone', async () => {
  // The mismatched pair is the failure mode: US country against a stored RWF
  // currency is what produced the error naming a country the host had left.
  const { seen, restore } = captureFetch();
  try {
    await addSellerDestination('sel_1', {
      payoutProvider: 'flutterwave_momo',
      destination: '+250788123456',
      country: 'RW',
      currency: 'RWF',
      network: 'MTN',
      label: 'Mobile Money',
    });
    const body = JSON.parse(seen[0].body ?? '{}');
    assertEquals(body.country, 'RW');
    assertEquals(body.payout_currency, 'RWF');
    assertEquals(body.network, 'MTN');
  } finally {
    restore();
  }
});

Deno.test('explain_currencies names the host own currency alongside the defaults', async () => {
  // PayHold defaults to USD,EUR. The case that actually hurts is the currency
  // the host is already paid in dropping out — which PayHold cannot know,
  // because its payout branch is a catalogue keyed by country and currency.
  const { seen, restore } = captureFetch();
  try {
    await payoutRouteFor('RW', { explain: ['USD', 'EUR', 'RWF'] });
    assertEquals(
      seen[0].url,
      'https://payhold.test/v1/payment-options?payout_country=RW&explain_currencies=USD%2CEUR%2CRWF',
    );
  } finally {
    restore();
  }
});

Deno.test('an empty explain list falls back to PayHold own default', async () => {
  // Sending `explain_currencies=` empty would ask for nothing to be
  // explained, which is different from not asking.
  const { seen, restore } = captureFetch();
  try {
    await payoutRouteFor('RW', { explain: [] });
    assertEquals(seen[0].url, 'https://payhold.test/v1/payment-options?payout_country=RW');
  } finally {
    restore();
  }
});

Deno.test('a connect session states the country, never an empty body', async () => {
  // This posted `{}`, which PayHold reads as "no opinion" and answers from the
  // stored `seller.country`. A host who had moved to the US was refused with
  // "We cannot pay out to Rwanda through Stripe" on a screen that said
  // "Paying out from: United States" three rows above it.
  //
  // It matters more here than on a destination: Stripe fixes an account's
  // country when the account is created and will not change it afterwards, so
  // a session opened with the wrong country mints an account in the wrong
  // market permanently — re-onboarding reuses the same pending account and
  // cannot repair it.
  const { seen, restore } = captureFetch();
  try {
    await startConnectSession('sel_1', { country: 'US' });
    assertEquals(seen[0].url, 'https://payhold.test/v1/sellers/sel_1/connect/session');
    assertEquals(seen[0].method, 'POST');
    assertEquals(JSON.parse(seen[0].body ?? '{}').country, 'US');
  } finally {
    restore();
  }
});
