import { assertEquals } from 'jsr:@std/assert@^1.0.0';
import { payoutProviderFor, payoutRailFromRoute } from '../payhold.ts';

/**
 * `FLUTTERWAVE_PAYOUT_KIND` is a hardcoded copy of PayHold's routing, kept
 * because `payoutProviderFor` has to answer synchronously on the registration
 * path. It has now drifted twice, and both times real hosts could not set up
 * payouts until somebody noticed by hand:
 *
 *   • **BF was missing** from the set, so a Burkinabè bank account routed to
 *     `stripe_connect` and `assertRailOnRoute` refused the rail.
 *   • **BF was then stale in the other direction** (2026-09-10): Flutterwave
 *     has no destination there of either kind, PayHold started blocking it,
 *     and this table still handed out `flutterwave_momo`.
 *
 * So the corridors that have actually cost something are pinned here. Re-derive
 * against PayHold's generated `_shared/countries.ts` when a row moves:
 *   COUNTRIES.filter(c => c.flutterwavePayout)
 *            .map(c => [c.code, c.momoPayout ? 'momo' : 'bank'])
 */

Deno.test('a market nothing can pay out to refuses every method', () => {
  // Flutterwave collects in both and pays out to neither; Stripe cannot reach a
  // recipient in an African corridor at all. Answering `stripe_connect` here is
  // the bug that stranded Burkinabè hosts.
  for (const country of ['BF', 'EG']) {
    assertEquals(payoutProviderFor('momo', country), null, `momo/${country}`);
    assertEquals(payoutProviderFor('bank', country), null, `bank/${country}`);
    assertEquals(payoutProviderFor('card', country), null, `card/${country}`);
  }
});

Deno.test('Ethiopia pays to a wallet, with bank as the fallback', () => {
  // ET has no collection channel, so the registry's `momo` flag is false and
  // reading it put this corridor on `bank`. `momoPayout` is the flag that
  // matters here, and Amole Money takes payouts.
  assertEquals(payoutProviderFor('momo', 'ET'), 'flutterwave_momo');
  assertEquals(payoutProviderFor('bank', 'ET'), 'flutterwave_bank');
  assertEquals(payoutProviderFor('card', 'ET'), null);
});

Deno.test('the genuine bank-only corridors keep refusing mobile money', () => {
  // Flutterwave has no wallet to send to in either, which is a different fact
  // from Ethiopia's and must not be collapsed into it.
  for (const country of ['NG', 'ZA']) {
    assertEquals(payoutProviderFor('momo', country), null, `momo/${country}`);
    assertEquals(payoutProviderFor('bank', country), 'flutterwave_bank', `bank/${country}`);
  }
});

Deno.test('an untouched wallet corridor still routes both ways', () => {
  assertEquals(payoutProviderFor('momo', 'KE'), 'flutterwave_momo');
  assertEquals(payoutProviderFor('bank', 'KE'), 'flutterwave_bank');
  assertEquals(payoutProviderFor('card', 'KE'), null);
});

Deno.test('outside the Flutterwave corridors, bank and card still mean Stripe', () => {
  assertEquals(payoutProviderFor('bank', 'FR'), 'stripe_connect');
  assertEquals(payoutProviderFor('card', 'US'), 'stripe_connect');
  assertEquals(payoutProviderFor('momo', 'US'), null);
});

Deno.test('the declared-and-disabled wallet rails are still not ways to get paid', () => {
  // §29.3: no provider on the route row, no live adapter, and not in PayHold's
  // `payout_provider` enum — including in a country whose own rail works.
  for (const method of ['paypal', 'venmo', 'cash_app', 'alipay', 'wechat_pay'] as const) {
    assertEquals(payoutProviderFor(method, 'US'), null, `${method}/US`);
    assertEquals(payoutProviderFor(method, 'KE'), null, `${method}/KE`);
  }
});

Deno.test('country codes are matched case-insensitively', () => {
  // The registration path receives whatever the client sent.
  assertEquals(payoutProviderFor('bank', 'bf'), null);
  assertEquals(payoutProviderFor('momo', 'et'), 'flutterwave_momo');
});

/**
 * `payoutRailFromRoute` is the live-route mirror of `payoutProviderFor`, and
 * the only thing standing between a stale table and a host being told there is
 * no way to pay them. It has to be *exactly* as strict as the table on the
 * combinations that are genuinely dead — rescuing a refusal that should have
 * stood would register a destination that can never be paid, which is the
 * failure this whole file exists to prevent.
 */

const route = (
  provider: 'flutterwave' | 'stripe' | null,
  kind: 'momo' | 'bank' | 'connect' | null,
  blocked = false,
) => ({
  country: { code: 'XX', name: 'Test', flag: '' },
  payout: { provider, kind, currency: 'XXX', blocked, verified: true, reason: '' },
  rails_verified: true,
});

Deno.test('a live wallet corridor rescues a refusal the table got wrong', () => {
  // The MW shape: PayHold opens a wallet corridor, the table has not caught up.
  assertEquals(payoutRailFromRoute('momo', route('flutterwave', 'momo')), 'flutterwave_momo');
});

Deno.test('a wallet route does not imply the bank corridor is open', () => {
  // KE and TZ are wallet-yes / bank-no — Flutterwave gates both bank corridors
  // and they left `flutterwave_bank` on 2026-09-09. MW is the same shape. A
  // single `kind` cannot say it, so the rescue must not infer it: answering
  // `flutterwave_bank` here sends a destination `assertRailOnRoute` will
  // refuse, which is worse than the local refusal it replaced.
  assertEquals(payoutRailFromRoute('bank', route('flutterwave', 'momo')), null);
});

Deno.test('a live bank corridor still has no wallet to send to', () => {
  assertEquals(payoutRailFromRoute('momo', route('flutterwave', 'bank')), null);
  assertEquals(payoutRailFromRoute('bank', route('flutterwave', 'bank')), 'flutterwave_bank');
});

Deno.test('Flutterwave never pays out to a card, however live the route is', () => {
  assertEquals(payoutRailFromRoute('card', route('flutterwave', 'momo')), null);
  assertEquals(payoutRailFromRoute('card', route('flutterwave', 'bank')), null);
});

Deno.test('Stripe Connect reaches a bank account or a debit card, nothing else', () => {
  assertEquals(payoutRailFromRoute('bank', route('stripe', 'connect')), 'stripe_connect');
  assertEquals(payoutRailFromRoute('card', route('stripe', 'connect')), 'stripe_connect');
  assertEquals(payoutRailFromRoute('momo', route('stripe', 'connect')), null);
});

Deno.test('a blocked corridor rescues nothing', () => {
  // The BF shape. A refusal here is correct and must survive the second
  // opinion, or the check becomes a way to register unpayable destinations.
  for (const m of ['momo', 'bank', 'card'] as const) {
    assertEquals(payoutRailFromRoute(m, route('flutterwave', 'momo', true)), null, m);
    assertEquals(payoutRailFromRoute(m, route(null, null, true)), null, `${m} (no provider)`);
  }
});

Deno.test('a route with no provider rescues nothing', () => {
  assertEquals(payoutRailFromRoute('bank', route(null, null)), null);
  assertEquals(payoutRailFromRoute('momo', route(null, null)), null);
});

Deno.test('the disabled wallet rails are not rescued by any live route', () => {
  // §29.3 has no live adapter behind any of the five, so no route shape may
  // turn one into a rail — including the Stripe route that reaches a card.
  for (const method of ['paypal', 'venmo', 'cash_app', 'alipay', 'wechat_pay'] as const) {
    assertEquals(payoutRailFromRoute(method, route('stripe', 'connect')), null, method);
    assertEquals(payoutRailFromRoute(method, route('flutterwave', 'momo')), null, method);
  }
});

/**
 * `methods` — PayHold answering "what can this market actually be paid into"
 * directly, instead of AutoHire inferring it from `kind`. It arrives inside
 * `payout`, and it is the authority whenever it is present.
 */

const withMethods = (
  provider: 'flutterwave' | 'stripe' | null,
  kind: 'momo' | 'bank' | 'connect' | null,
  methods: ('momo' | 'bank' | 'connect' | 'paypal')[],
  blocked = false,
) => ({
  country: { code: 'XX', name: 'Test', flag: '' },
  payout: { provider, kind, currency: 'XXX', blocked, verified: true, reason: '', methods },
  rails_verified: true,
});

Deno.test('the KE/TZ shape: a wallet market whose bank corridor is closed', () => {
  const ke = withMethods('flutterwave', 'momo', ['momo']);
  assertEquals(payoutRailFromRoute('momo', ke), 'flutterwave_momo');
  assertEquals(payoutRailFromRoute('bank', ke), null);
  assertEquals(payoutRailFromRoute('card', ke), null);
});

Deno.test('the ET shape: a market that takes either', () => {
  const et = withMethods('flutterwave', 'momo', ['momo', 'bank']);
  assertEquals(payoutRailFromRoute('momo', et), 'flutterwave_momo');
  assertEquals(payoutRailFromRoute('bank', et), 'flutterwave_bank');
});

Deno.test('methods overrides kind rather than being checked after it', () => {
  // A rail switched off leaves `methods` while `kind` still names it — that is
  // the whole point of deriving from route_evaluation. The list must win.
  const stale = withMethods('flutterwave', 'bank', ['momo']);
  assertEquals(payoutRailFromRoute('bank', stale), null);
  assertEquals(payoutRailFromRoute('momo', stale), 'flutterwave_momo');
});

Deno.test('a connect market reaches a bank account or a card', () => {
  const us = withMethods('stripe', 'connect', ['connect']);
  assertEquals(payoutRailFromRoute('bank', us), 'stripe_connect');
  assertEquals(payoutRailFromRoute('card', us), 'stripe_connect');
  assertEquals(payoutRailFromRoute('momo', us), null);
});

Deno.test('an empty methods list rescues nothing', () => {
  const closed = withMethods('flutterwave', 'momo', []);
  for (const m of ['momo', 'bank', 'card'] as const) {
    assertEquals(payoutRailFromRoute(m, closed), null, m);
  }
});

Deno.test('a blocked market rescues nothing even if methods says otherwise', () => {
  const contradictory = withMethods('flutterwave', 'momo', ['momo'], true);
  assertEquals(payoutRailFromRoute('momo', contradictory), null);
});

Deno.test('the disabled wallet rails are not rescued by a methods list either', () => {
  const open = withMethods('stripe', 'connect', ['connect']);
  for (const method of ['paypal', 'venmo', 'cash_app', 'alipay', 'wechat_pay'] as const) {
    assertEquals(payoutRailFromRoute(method, open), null, method);
  }
});


Deno.test('Malawi pays to a wallet, and its bank corridor stays shut', () => {
  // Opened 2026-09-10 by PayHold's `20260910000004` — Airtel Money
  // (`AIRTELMW`, MWK). It left `NO_PAYOUT_RAIL` on the same day, which is the
  // first time a country has moved *into* payability rather than out of it.
  //
  // `bank` still answers `flutterwave_bank` from the table because one kind per
  // country cannot say "wallet yes, bank no" — the live route does, and
  // `payoutRailFromRoute` refuses it there. That split is the design, not an
  // oversight: the table is the synchronous approximation and `payout.methods`
  // is the authority.
  assertEquals(payoutProviderFor('momo', 'MW'), 'flutterwave_momo');
  assertEquals(payoutProviderFor('card', 'MW'), null);
  assertEquals(
    payoutRailFromRoute('bank', withMethods('flutterwave', 'momo', ['momo'])),
    null,
  );
});

/**
 * PayPal, live since PayHold's `20260910000005`.
 *
 * The bug these pin: `payoutRailFromRoute` refused all five §29.3 wallets under
 * the comment "never in `methods` — no rail carries them". True when written,
 * false an hour later, and the result was a US host offered PayPal by the
 * payout screen and refused by the registration path.
 *
 * Eligibility is per (country, currency), not per country — PayPal's currency
 * list intersected with what PayHold can price — so nothing here may assert a
 * country. `methods` is the only authority and these tests only ever vary it.
 */

const ppRoute = (methods: ('momo' | 'bank' | 'connect' | 'paypal')[]) =>
  withMethods('stripe', 'connect', methods);

Deno.test('PayPal is a rail wherever PayHold names it', () => {
  assertEquals(payoutRailFromRoute('paypal', ppRoute(['connect', 'paypal'])), 'paypal');
  // A market only PayPal reaches.
  assertEquals(
    payoutRailFromRoute('paypal', withMethods(null, null, ['paypal'])),
    'paypal',
  );
});

Deno.test('PayPal is refused wherever PayHold does not name it', () => {
  // The same country in a currency PayPal cannot take — KES, RWF, NGN, GHS are
  // outside its list, so the route comes back without it and this must refuse.
  assertEquals(payoutRailFromRoute('paypal', withMethods('flutterwave', 'momo', ['momo'])), null);
  assertEquals(payoutRailFromRoute('paypal', ppRoute(['connect'])), null);
});

Deno.test('a blocked market does not pay by PayPal either', () => {
  assertEquals(
    payoutRailFromRoute('paypal', withMethods('stripe', 'connect', ['paypal'], true)),
    null,
  );
});

Deno.test('the four still-disabled wallets are not rescued by PayPal going live', () => {
  // §29.3 minus PayPal. Enabling one rail must not enable its neighbours.
  for (const method of ['venmo', 'cash_app', 'alipay', 'wechat_pay'] as const) {
    assertEquals(payoutRailFromRoute(method, ppRoute(['connect', 'paypal'])), null, method);
  }
});

Deno.test('the synchronous table still refuses PayPal, and that is the design', () => {
  // It cannot know a per-(country, currency) fact, so it defers rather than
  // guesses — the refusal is a question the live route answers.
  assertEquals(payoutProviderFor('paypal', 'US'), null);
  assertEquals(payoutProviderFor('paypal', 'KE'), null);
});
