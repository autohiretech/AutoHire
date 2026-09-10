import { CreditCard, Landmark, QrCode, Smartphone, Wallet } from 'lucide-react';
import type { PaymentMethodType, PayoutMethodType, PayoutProvider } from '@autohire/shared';

/**
 * One icon per payout method — shared so a card never quietly renders as a
 * bank account or vice versa. Two screens used to keep their own copy of
 * this; a destination row on the Earnings screen always showed a generic
 * banknote regardless of the actual method, because nothing there decided
 * per method at all.
 */
export const PAYOUT_METHOD_ICON: Record<PayoutMethodType, typeof Smartphone> = {
  momo: Smartphone,
  bank: Landmark,
  card: CreditCard,
  // The wallets share an icon on purpose: they are the same shape of thing —
  // an account held with a provider — and the label already names which.
  //
  // **Nothing offers any of the five as a payout method any more.** They are
  // §29.3's declared-and-disabled rails: no provider on the route row, no live
  // adapter, and absent from PayHold's `payout_provider` enum, so a destination
  // on one cannot be stored let alone paid. They survive here and in
  // `PAYOUT_METHOD_META` only because `PayoutMethodType` in `@autohire/shared`
  // still declares them and these are total records over it — see
  // `payoutMethodsFor`. Deleting them is a change to that shared type.
  paypal: Wallet,
  venmo: Wallet,
  cash_app: Wallet,
  alipay: QrCode,
  wechat_pay: QrCode,
};

/**
 * Payment orchestration — the user picks a method they understand (mobile money,
 * bank, card); the SYSTEM decides which rail moves the money. Flutterwave is the
 * workhorse for Africa (collections + payouts to MoMo/bank); Stripe handles
 * international cards and cross-border payouts. Nothing here exposes the provider
 * to the user — it's an implementation detail routed on method + country.
 */

/**
 * Live payments on? When false (default) the app uses the demo checkout / payout
 * flows. Set `VITE_PAYMENTS_LIVE=true` once the provider Edge Functions + secrets
 * (Flutterwave / Stripe) are deployed.
 */
export const PAYMENTS_LIVE = import.meta.env.VITE_PAYMENTS_LIVE === 'true';

/**
 * Payments run through the EXTERNAL hold system. Set `VITE_PAYMENTS_EXTERNAL=true`
 * once its Edge Functions + secrets are deployed (see docs/payments-external.md).
 * When on, it handles every market and the per-market Stripe/Flutterwave routing
 * below is bypassed — the renter still just picks card or mobile money.
 */
export const PAYMENTS_EXTERNAL = import.meta.env.VITE_PAYMENTS_EXTERNAL === 'true';

/**
 * Payments run through PayHold — the escrow platform AutoHire is tenant #1 on.
 * Set `VITE_PAYMENTS_PAYHOLD=true` once its Edge Functions + secrets are
 * deployed (see docs/payhold.md).
 *
 * When on, PayHold owns the whole money path: the renter pays on its hosted
 * page, it holds the funds until both sides confirm, and it pays the host out.
 * Every per-market Stripe/Flutterwave decision below is bypassed — PayHold
 * makes those itself, and better, because it can see both ends of the corridor.
 *
 * Takes precedence over PAYMENTS_EXTERNAL: both being on is a misconfiguration,
 * and silently splitting checkout across two escrow systems would be worse than
 * picking one.
 */
export const PAYMENTS_PAYHOLD = import.meta.env.VITE_PAYMENTS_PAYHOLD === 'true';


/**
 * Flutterwave's payout corridors, and which kind of destination each reaches.
 *
 * **This is a copy of PayHold's data and it should not be one.** PayHold is the
 * authority on where money can go: `payoutMethodsFromRoute` below reads its
 * live per-country route and is what every screen actually renders from. This
 * table exists only for `payoutMethodsFor`, the last-resort fallback for when
 * PayHold cannot be reached at all — see the argument on that function.
 *
 * A copy drifts, and this one did. It held eight codes and was missing **BF,
 * CM, SN, ZM and ET**, so hosts in Burkina Faso, Cameroon, Senegal, Zambia and
 * Ethiopia were told their market was unsupported when PayHold pays all five.
 * The same drift in the Edge Function's own copy
 * (`supabase/functions/_shared/payhold.ts`) was worse: it routed a Burkinabè
 * bank account to `stripe_connect`, PayHold's `assertRailOnRoute` refused the
 * rail, and the host could not set up payouts at all.
 *
 * Membership is PayHold's `flutterwavePayout`; the kind is its `momoPayout`
 * flag, which is exactly how PayHold's own `payoutRoute` decides it. Both come
 * from PayHold's generated `_shared/countries.ts`. When this and a live route
 * disagree, `payoutAvailability` says so out loud rather than quietly
 * preferring one; see `warnOnMethodDrift`.
 *
 * **The kind used to be read from `momo` and that is now a different fact.**
 * PayHold split that boolean in two on 2026-09-10: `momo` means a wallet can be
 * *charged* here, `momoPayout` means one can be *paid* here. They come from two
 * provider pages and they disagree — Ethiopia has no collection channel at all
 * (`momo: false`) while Amole Money takes payouts, which is why **ET** sat on
 * `bank` here and is `momo` now. Nigeria and South Africa are the genuine bank
 * corridors: Flutterwave has no wallet to send to in either.
 */
const FLUTTERWAVE_PAYOUT_KIND: Record<string, 'momo' | 'bank'> = {
  CI: 'momo',
  CM: 'momo',
  ET: 'momo',
  GH: 'momo',
  KE: 'momo',
  MW: 'momo',
  NG: 'bank',
  RW: 'momo',
  SN: 'momo',
  TZ: 'momo',
  UG: 'momo',
  ZA: 'bank',
  ZM: 'momo',
};

/**
 * Flutterwave collects here and nothing pays out here — the two facts crossing
 * over, in the markets where they cross the wrong way.
 *
 * A host in one of these cannot be paid by any rail PayHold has: Flutterwave
 * does not pay out to them and Stripe cannot reach a recipient in an African
 * corridor at all. Without this set they fall out of `FLUTTERWAVE_PAYOUT_KIND`
 * and `payoutMethodsFor` offers them `['bank', 'card']` — both of which route
 * to Stripe Connect, which needs an `acct_…` AutoHire has never built.
 *
 * **BF joined it on 2026-09-10.** Burkina Faso's Flutterwave transfer guide is
 * real, but `/banks/BF` errors so there are no bank codes to send to, and the
 * momo transfer table names no Burkinabè network — there is no destination of
 * either kind, so it left the payout table above. It stays in
 * `FLUTTERWAVE_COLLECT_COUNTRIES`: renters there can still pay, and that is a
 * separate flag (`flutterwaveLocal`) that did not move.
 *
 * **MW left it the same day**, the other way round: Malawi's wallet corridor
 * opened, so Airtel Money reaches a Malawian host and the country moved up into
 * the kind table. Its bank corridor is still closed — which this set was never
 * the place to say, and `payout.methods` says per request.
 *
 * Re-derive with:
 *   COUNTRIES.filter(c => c.flutterwaveLocal && !c.flutterwavePayout && !c.stripePayout)
 *            .map(c => c.code)
 */
const NO_PAYOUT_RAIL = new Set(['BF', 'EG']);

/**
 * The markets Flutterwave *collects* in locally, which is a different fact.
 *
 * PayHold's registry keeps `flutterwaveLocal` and `flutterwavePayout` as two
 * flags from two provider pages, and they disagree: Egypt and Malawi collect
 * but cannot pay out, Ethiopia pays out with no collection channel at all,
 * Zambia has mobile money out and no local card acquiring in. One constant used
 * to answer both questions here, which is part of why nobody could tell which
 * fact was stale.
 */
const FLUTTERWAVE_COLLECT_COUNTRIES = new Set([
  'BF', 'CI', 'CM', 'EG', 'GH', 'KE', 'MW', 'NG', 'RW', 'SN', 'TZ', 'UG', 'ZA',
]);

/**
 * Is this an African market whose money lands as a local currency (MoMo/bank)?
 *
 * Both ends, deliberately. The one caller that matters is `providerForBooking`,
 * and on the legacy non-PayHold rail a single provider carries a whole booking
 * — collection, hold and payout — so a market that can only do one half of that
 * is not one of these. Egypt and Malawi collect and cannot pay out; Ethiopia
 * and Zambia are the reverse.
 */
export function isAfricanMarket(countryCode: string): boolean {
  const code = countryCode.toUpperCase();
  return FLUTTERWAVE_COLLECT_COUNTRIES.has(code) && code in FLUTTERWAVE_PAYOUT_KIND;
}

/**
 * Can Flutterwave take a renter's money here? The collection half on its own.
 *
 * `isAfricanMarket` deliberately answers "both halves", which is the right
 * question for `providerForBooking` and the wrong one for anything about what
 * a renter can pay with. That distinction had no consequences while the two
 * lists happened to coincide, and acquired some on 2026-09-10: Burkina Faso
 * left the payout table (see `NO_PAYOUT_RAIL`) while still collecting, so
 * `isAfricanMarket('BF')` went false and every collection-side caller reading
 * it would have quietly stopped offering Burkinabè renters mobile money —
 * taking a working payment method away from a market over a fact about
 * *payouts*.
 *
 * Egypt and Malawi have been in that position all along and were getting the
 * same wrong answer for the same reason.
 */
export function collectsLocally(countryCode: string): boolean {
  return FLUTTERWAVE_COLLECT_COUNTRIES.has(countryCode.toUpperCase());
}

/**
 * THE routing rule. One provider handles a whole booking — collection, hold and
 * payout — decided by the CAR's market (where the money must land), NOT where the
 * renter is. A US renter paying a Rwandan car still goes through Flutterwave.
 */
export function providerForBooking(carCountryCode: string): PayoutProvider {
  if (PAYMENTS_PAYHOLD) return 'payhold';
  if (PAYMENTS_EXTERNAL) return 'external';
  return isAfricanMarket(carCountryCode) ? 'flutterwave' : 'stripe';
}

/** Which provider a host's payout method routes to (matches their market). */
export function payoutProviderFor(method: PayoutMethodType, countryCode: string): PayoutProvider {
  if (PAYMENTS_PAYHOLD) return 'payhold';
  if (PAYMENTS_EXTERNAL) return 'external';
  if (method === 'momo') return 'flutterwave'; // mobile money is African → Flutterwave
  if (method === 'card') return 'stripe'; // push-to-card / international → Stripe
  return isAfricanMarket(countryCode) ? 'flutterwave' : 'stripe';
}

/**
 * The payout methods offered in a given market, most local first — **and only
 * when PayHold could not be reached.**
 *
 * `payoutAvailability` prefers `payoutMethodsFromRoute` in every other case,
 * because PayHold's own route is the only thing that actually knows. This is
 * the answer given while that is loading or unreachable, and the reason it
 * still exists is that a blank payout screen is worse than an approximate one.
 *
 * It is now the same approximation `payoutMethodsFromRoute` would make, rather
 * than a different and more generous one. What it used to offer instead:
 *
 *   • **PayPal, Venmo and Cash App to every US host, Alipay and WeChat Pay to
 *     every Chinese one, PayPal to everybody else.** All five are §29.3's
 *     declared-and-disabled rails on PayHold: their `payout_routes` rows carry
 *     no provider, which a check constraint turns into "cannot be enabled", and
 *     PayHold's `payout_provider` enum has only three values — none of them
 *     these. There is no PayPal payout integration on either side of this and
 *     there is not going to be one by accident, so a host who picked one saved
 *     a destination that could never be paid.
 *
 *   • **Card inside Flutterwave's corridors.** Stripe cannot reach a recipient
 *     there and Flutterwave has no card payout at all — the same dead end
 *     `payoutMethodsFromRoute` was written to close, left open here.
 *
 *   • **MoMo in Nigeria and South Africa**, where Flutterwave pays by bank
 *     transfer and there is no wallet to send to.
 *
 * Outside the Flutterwave corridors this stays optimistic — `['bank', 'card']`,
 * Stripe Connect's pair — rather than enumerating Stripe's forty-odd payout
 * countries into a third copy of somebody else's list. That guess is wrong for
 * a host in a market PayHold cannot pay, and it is wrong for exactly as long as
 * PayHold is unreachable: `payoutAvailability` reads `can_payout` and answers
 * `unavailable` the moment it can hear back.
 */
export function payoutMethodsFor(countryCode: string): PayoutMethodType[] {
  // Known limit, and deliberately left: a `momo` row here yields
  // `['momo', 'bank']`, so this over-offers Bank in the markets that take a
  // wallet while their bank corridor is closed — KE, TZ, MW. One kind per
  // country cannot say otherwise, and the fix is not a second hardcoded list
  // but `payout.methods`, which `payoutMethodsFromRoute` already prefers
  // whenever PayHold can be reached at all. This runs only when it cannot, and
  // `warnOnMethodDrift` reports the disagreement the moment it can.
  const code = countryCode.toUpperCase();
  // No rail reaches these at all, so the `['bank', 'card']` default below would
  // be two methods that both dead-end at Stripe Connect. `payoutAvailability`
  // turns the empty list into "not open yet" rather than rendering nothing.
  if (NO_PAYOUT_RAIL.has(code)) return [];

  const kind = FLUTTERWAVE_PAYOUT_KIND[code];
  if (kind === 'momo') return ['momo', 'bank'];
  if (kind === 'bank') return ['bank'];
  return ['bank', 'card'];
}

/** One country's capabilities as PayHold reports them (`payhold-payment-options`). */
export interface PayoutCountry {
  code: string;
  name: string;
  flag: string;
  currency: string;
  can_collect: boolean;
  can_payout: boolean;
  restricted: boolean;
  closed_reason: string | null;
}

/** One country's actual payout route, as PayHold's `payoutRoute` decides it. */
export interface PayoutCountryRoute {
  country: { code: string; name: string; flag: string };
  payout: {
    provider: 'flutterwave' | 'stripe' | null;
    kind: 'momo' | 'bank' | 'connect' | null;
    currency: string;
    blocked: boolean;
    verified: boolean;
    reason: string;
    /**
     * Every destination this market can actually be paid into, not just the
     * preferred one — PayHold's answer to the question `kind` cannot answer.
     *
     * `kind` is a single value and a market is not. Kenya and Tanzania take a
     * wallet while their bank corridor sits behind a Flutterwave request,
     * Malawi is the same, Ethiopia takes either. Reading `kind: 'momo'` as
     * "wallet and bank" is the obvious inference and it is wrong — it showed
     * Kenyan hosts a Bank option that `assertRailOnRoute` then refused.
     *
     * PayHold derives it from `route_evaluation` rather than from its registry,
     * so it is what the routing table carries this second: a rail switched off,
     * risk-held or missing its adapter drops out on its own. `kind` sorts
     * first, so the preferred destination is still the head of the list.
     *
     * Optional because a market an operator has closed by hand answers without
     * it, and because a client may be reading a PayHold that predates the
     * field. `payoutMethodsFromRoute` falls back to the old inference then.
     */
    methods?: ('momo' | 'bank' | 'connect' | 'paypal')[];
  };
  /**
   * The mobile-money wallets that exist in this country — "MTN", "Airtel
   * Money", "M-Pesa". A momo destination has to name one: PayHold used to
   * guess it from the number and now refuses to, because a wrong guess
   * registered a destination Flutterwave will not actually transfer to and
   * nothing said so until a payout failed weeks later.
   */
  networks?: string[];
  /**
   * The banks, when they were asked for (`payholdPayoutRoute(code, { banks:
   * true })`). **`null` is not an empty list** — it means "not asked for", or
   * "the rail could not be reached to enumerate them". Rendering it as "no
   * banks available" would be a lie about a country full of banks, so the
   * screen falls back to a plain code field instead.
   */
  banks?: { code: string; name: string }[] | null;
  rails_verified: boolean;
}

/**
 * What a renter in one country can be charged, straight from PayHold.
 *
 * The collection counterpart of `PayoutCountryRoute`. `currencies` is the
 * authoritative list — every currency that market's rails can take,
 * intersected with the ones AutoHire's PayHold account has enabled — and
 * neither half of that is derivable here, which is why this replaced a guess.
 */
export interface CollectionOptions {
  country: { code: string; name: string; flag: string; currency: string };
  restricted: boolean;
  closed?: boolean;
  /** The currency `methods` are quoted in. */
  charged_in?: string;
  methods: { method: string; label: string; networks?: string[] }[];
  /** Empty when the market is shut or sanctioned — then nobody there can pay. */
  currencies: string[];
  reason?: string;
  rails_verified: boolean;
}

/**
 * The currencies to offer a renter in `countryCode`, in the order to offer them.
 *
 * **PayHold decides which currencies exist; this decides only the order.** The
 * list used to be assembled here — the country's own currency plus USD/EUR/GBP
 * — which was a guess in both directions: it could offer a currency the market's
 * rails cannot take, and hide one they can. `options.currencies` is the real
 * answer and is passed straight through.
 *
 * Their own market's currency leads where it is offered: it is the one that
 * needs no conversion and the one their card is least likely to be surcharged
 * for. An empty list is a market that cannot pay at all, and is returned as
 * such rather than papered over with USD — the checkout has to say so rather
 * than offer a currency the charge would then be refused in.
 */
export function presentmentCurrenciesFor(
  countryCode: string,
  countries: PayoutCountry[] | undefined,
  options: CollectionOptions | undefined,
): string[] {
  const offered = options?.currencies ?? [];
  if (offered.length === 0) return [];

  const local = options?.country?.currency ??
    countries?.find((c) => c.code === countryCode)?.currency;

  return local && offered.includes(local)
    ? [local, ...offered.filter((c) => c !== local)]
    : [...offered];
}

/**
 * Which methods a `payoutRoute` answer actually supports — the specific fix
 * for the gap `payoutMethodsFor` left even after the bulk `can_payout` check
 * landed. A country being payable at all said nothing about which methods
 * work inside it: PayPal, Venmo, Cash App, Alipay and WeChat Pay were offered
 * as payout methods wherever those brands are known, when none of the five
 * has a live payout adapter on PayHold yet (§9: declared and disabled), and
 * Card was offered in Flutterwave's African corridors, where Stripe cannot
 * reach a recipient and Flutterwave has no card payout at all — either one is
 * a host who picks a method, saves a number, and finds their first payout
 * stuck at `blocked` weeks later with nothing they can do about it.
 *
 * Flutterwave never offers `card` — it settles to a wallet or a bank account,
 * never a card — and Stripe Connect can send to either a bank account or a
 * debit card, so `connect` offers both.
 */
export function payoutMethodsFromRoute(
  route: PayoutCountryRoute['payout'] | null | undefined,
): PayoutMethodType[] {
  if (!route || route.blocked) return [];

  // `methods` is PayHold answering the question directly, so nothing is
  // inferred from `kind` when it is there. It arrives as payout *kinds* rather
  // than as the methods a host picks, and `connect` is the one that is not a
  // one-to-one mapping: Stripe Connect sends to a bank account or a debit card,
  // so it becomes both. Order is preserved because PayHold sorts `kind` first.
  //
  // `paypal` joined the vocabulary on 2026-09-10 and passes straight through,
  // which is why this screen offered it correctly from the moment PayHold
  // enabled it while `payhold-register-seller` was still refusing it. Its
  // eligibility is per (country, currency) — a Kenyan seller paid in USD gets
  // it, the same seller paid in KES does not — so only this list can say.
  if (route.methods) {
    const out: PayoutMethodType[] = [];
    for (const kind of route.methods) {
      for (const m of kind === 'connect' ? (['bank', 'card'] as const) : ([kind] as const)) {
        if (!out.includes(m)) out.push(m);
      }
    }
    return out;
  }

  // A PayHold that predates `methods`. This is the inference that showed a
  // Kenyan host Bank and had it refused — kept only because answering nothing
  // would empty the payout screen, and narrowed nowhere, because guessing
  // *fewer* methods would hide a corridor that works in the markets where
  // wallet and bank both do.
  if (route.provider === 'flutterwave' && route.kind === 'momo') return ['momo', 'bank'];
  if (route.provider === 'flutterwave' && route.kind === 'bank') return ['bank'];
  if (route.provider === 'stripe' && route.kind === 'connect') return ['bank', 'card'];
  return [];
}

/**
 * What a host in this country can actually do — the answer the setup screen
 * needs, rather than a method list that may lead nowhere.
 *
 * `payoutMethodsFor` alone was a promise AutoHire could not keep. It returned
 * `['bank', 'card']` for every country outside the Flutterwave eight, but both
 * of those route to `stripe_connect`, and PayHold refuses a raw number there —
 * a Stripe destination is an `acct_…` minted by Connect onboarding, which
 * AutoHire has not built. Hosts in those markets could pick a method, submit,
 * and only then discover there was no way through.
 *
 * So this returns a state, not a list, and the states that are not `ok` each
 * carry the reason. `unavailable` and `unsupported` are deliberately different:
 * the first is a corridor PayHold may open later, the second is work on our
 * side that a host can do nothing about, and telling them apart is the
 * difference between "not yet" and "not you".
 */
export type PayoutAvailability =
  | { state: 'ok'; methods: PayoutMethodType[] }
  /** PayHold cannot pay this country at all — China, and ~122 others. */
  | { state: 'unavailable'; reason: string | null }
  /** Sanctioned. Neither direction, and not a corridor that will open. */
  | { state: 'restricted' }
  /**
   * PayHold names a route for this country, it is not blocked, and
   * `payoutMethodsFromRoute` still cannot map it to a method — a rail/kind
   * pair we have no case for. Every route PayHold returns today does map
   * (Flutterwave momo/bank, Stripe Connect), so this is a defensive fallback
   * for a shape it might return in the future.
   *
   * **A blocked corridor is deliberately not this.** It used to land here,
   * because a blocked route maps to no methods, and the screen then told the
   * host their country was an unexplained fault. That is handled above now,
   * and this state is back to meaning what its message says: unexpected.
   */
  | { state: 'unsupported' };

export function payoutAvailability(
  countryCode: string,
  known: PayoutCountry | null | undefined,
  /**
   * The per-country route, when it has loaded — see `payholdPayoutRoute`.
   * Optional and separate from `known` on purpose: the bulk list only says
   * whether a country is payable, and loads faster (one cached copy for
   * every host); the route says which methods actually work inside it, and
   * only ever needs asking about the signed-in host's own country. A `state:
   * 'ok'` with this still loading falls back to `payoutMethodsFor` exactly as
   * a missing `known` does — wrong the old way, not a blocked screen.
   */
  route?: PayoutCountryRoute['payout'] | null,
): PayoutAvailability {
  // No answer from PayHold — a cold cache, or the function is not deployed.
  // Fall back to the old list rather than blocking a host who may be perfectly
  // payable; being wrong the way we were before is better than a dead screen.
  //
  // The one thing not worth being wrong about offline is a market we know
  // nothing can pay: `payoutMethodsFor` answers `[]` there, and an `ok` with no
  // methods renders as a payout form with nothing in it. Say "not open yet"
  // instead — it is what PayHold will say when it can be reached, so the screen
  // does not change its mind once the route loads.
  if (!known) {
    return NO_PAYOUT_RAIL.has(countryCode.toUpperCase())
      ? { state: 'unavailable', reason: null }
      : { state: 'ok', methods: payoutMethodsFor(countryCode) };
  }

  if (known.restricted) return { state: 'restricted' };
  if (!known.can_payout) return { state: 'unavailable', reason: known.closed_reason };

  // A corridor PayHold has deliberately not opened is "not yet", not a fault.
  //
  // This branch has to come before the method mapping below, because
  // `payoutMethodsFromRoute` answers `[]` for a blocked route and an empty
  // list falls through to `unsupported` — which the screen renders in red as
  // "We couldn't work out how payouts route in {country}. This is unexpected —
  // try refreshing, and contact support." Every word of that is wrong here:
  // it is expected, refreshing cannot change it, and support cannot help.
  //
  // It became wrong on 2026-09-09, when PayHold's `payment-options` started
  // failing closed on corridors with no row in the routing table. `unsupported`
  // was written as a defensive case for a route shape we could not map, and
  // that day it silently became the answer for around forty-six countries.
  //
  // PayHold sends a sentence written for a person — "PayHold has no enabled
  // payout route into Poland in PLN yet" — so the honest thing is to show it
  // under the same "not open yet" heading a closed market gets, which also
  // tells the host renters can still book and pay.

  // The drift check runs before the `blocked` branch, not after it. That branch
  // returns, so a warner sitting underneath it can never see a blocked route —
  // which is half of why the BF drift went unreported. The check was written to
  // catch exactly a corridor PayHold had closed under a table that still
  // thought it open, and it was placed on the one path that shape never reaches.
  if (route) warnOnMethodDrift(countryCode, route);

  if (route?.blocked) {
    return { state: 'unavailable', reason: route.reason || known.closed_reason };
  }

  // PayHold says it can pay this country. `route` is the authority on which
  // methods actually work inside it — see `payoutMethodsFromRoute` — and
  // falls back to the local guess only while it is still loading, the same
  // "wrong the old way beats a dead screen" reasoning as the `!known` branch
  // above. Once it has loaded, an empty result from a route that is not
  // itself blocked would be new — every route PayHold can name maps to at
  // least one method today — so that case is treated as `unsupported` rather
  // than silently offering nothing.
  const methods = route ? payoutMethodsFromRoute(route) : payoutMethodsFor(countryCode);
  if (methods.length === 0) return { state: 'unsupported' };
  return { state: 'ok', methods };
}

/** Countries already reported, so one host's screen logs each drift once. */
const driftReported = new Set<string>();

/**
 * Say out loud when `FLUTTERWAVE_PAYOUT_KIND` and PayHold disagree.
 *
 * `payoutMethodsFor` is a hardcoded copy of PayHold's routing, and the only
 * honest thing to say about a copy is that it will drift. This one did, for
 * five countries, and nothing anywhere said so — the first sign was hosts in
 * those markets being told they could not be paid.
 *
 * So the copy is kept (there is no synchronous way to ask PayHold, and a blank
 * payout screen is worse than an approximate one) and the drift is made
 * *visible* instead. Every render of the payout screen already holds both
 * answers at once: PayHold's live route, and what the fallback would have said
 * about the same country. Comparing them is free, and it turns the next drift
 * into a console warning on the first host who opens the screen in the affected
 * market rather than into silence.
 *
 * **It only logs, and it never changes what is returned.** The live route wins
 * regardless — it is the authority and the table is the copy. A warning here
 * means `FLUTTERWAVE_PAYOUT_KIND` (here and its twin in
 * `supabase/functions/_shared/payhold.ts`) needs correcting against PayHold's
 * generated `countries.ts`.
 */
function warnOnMethodDrift(
  countryCode: string,
  route: NonNullable<PayoutCountryRoute['payout']>,
): void {
  const code = countryCode.toUpperCase();
  if (driftReported.has(code)) return;

  const live = payoutMethodsFromRoute(route);
  const fallback = payoutMethodsFor(code);

  // A deliberately closed corridor is usually not drift: `payment_markets` is
  // an overlay an operator sets with a reason, it moves without the registry
  // moving, and the branch above already renders it as "not open yet".
  //
  // **Unless this file still has it down as a Flutterwave payout corridor.**
  // That is the test, not "the fallback offered something": the fallback offers
  // `['bank', 'card']` to every country it has never heard of, so an emptiness
  // check would warn about all forty-six corridors PayHold closed on
  // 2026-09-09 — the noise this suppression exists to prevent. Membership in
  // `FLUTTERWAVE_PAYOUT_KIND` is a positive claim that Flutterwave pays here,
  // and PayHold blocking a country we claim that about is the drift that
  // registers destinations nothing can ever pay. It is how BF stayed silent:
  // this returned on `blocked` before reading the table at all.
  if (route.blocked && !(code in FLUTTERWAVE_PAYOUT_KIND)) return;
  if (!route.blocked && live.join() === fallback.join()) return;

  driftReported.add(code);
  console.warn(
    `[payments] payout-method drift for ${code}: PayHold ` +
      (route.blocked
        ? `BLOCKS payouts here (${route.reason || 'no reason given'})`
        : `routes it as ${route.provider ?? 'no provider'}/${route.kind ?? 'no kind'}`) +
      ` → [${live.join(', ')}], ` +
      `while the offline fallback says [${fallback.join(', ')}]. ` +
      `Correct FLUTTERWAVE_PAYOUT_KIND (here and in supabase/functions/` +
      `_shared/payhold.ts) against PayHold's generated countries.ts — until ` +
      `then, a host here gets the wrong methods whenever PayHold is unreachable.`,
  );
}

export const PAYOUT_METHOD_META: Record<
  PayoutMethodType,
  { label: string; blurb: string; field: string; placeholder: string }
> = {
  momo: {
    label: 'Mobile Money',
    blurb: 'MTN MoMo or Airtel Money. Paid out within ~24 hours.',
    field: 'Mobile money number',
    placeholder: '+250 788 123 456',
  },
  bank: {
    label: 'Bank account',
    blurb: 'Direct transfer to your bank account.',
    field: 'Bank account number',
    placeholder: 'Account number',
  },
  card: {
    label: 'Debit card',
    blurb: 'International payout to a Visa/Mastercard debit card.',
    field: 'Card number',
    placeholder: '4242 4242 4242 4242',
  },
  // Unreachable: no payout rail exists behind these five. See the note on
  // `PAYOUT_METHOD_ICON` — they are here to keep this record total, not to be
  // offered to anyone.
  paypal: {
    label: 'PayPal',
    // Not "usually within a day", which this said while PayPal was a dead
    // rail and nobody could reach it. A PayPal destination is checked and sits
    // in the same security hold as every other one, so promising next-day here
    // would have a host reading a normal hold as a fault.
    blurb: 'Paid to your PayPal account once it is verified.',
    // **"account email", deliberately.** A host who reads "PayPal email" as
    // "the email you use here" sends their earnings to an address with no
    // PayPal account behind it. PayPal will hold a payout for an unregistered
    // address and invite the recipient to open an account, so the money is not
    // lost — but it is unclaimable until they do, and nothing in AutoHire will
    // say why.
    field: 'PayPal account email',
    placeholder: 'you@example.com',
  },
  venmo: {
    label: 'Venmo',
    blurb: 'US only. Paid to your Venmo account.',
    field: 'Venmo username or phone',
    placeholder: '@yourname',
  },
  cash_app: {
    label: 'Cash App',
    blurb: 'US only. Paid to your $Cashtag.',
    field: 'Cashtag',
    placeholder: '$yourname',
  },
  alipay: {
    label: 'Alipay',
    blurb: 'Paid to your Alipay account.',
    field: 'Alipay email or phone',
    placeholder: 'you@example.com',
  },
  wechat_pay: {
    label: 'WeChat Pay',
    blurb: 'Paid to your WeChat Pay wallet.',
    field: 'WeChat ID or phone',
    placeholder: '+86 138 0013 8000',
  },
};

/**
 * The payment methods a renter can save in a given market — the mirror of
 * `payoutMethodsFor`. Card is universal; mobile money only where it settles.
 *
 * This is now driven by PayHold's `payment-options` / `can_collect`, not by a
 * constant. The fallback below only runs if PayHold is unreachable, in which
 * case we guess rather than block the booking flow.
 */
export function paymentMethodsFor(countryCode: string, known?: PayoutCountry | null): PaymentMethodType[] {
  if (known && !known.can_collect) return [];
  // `collectsLocally`, not `isAfricanMarket`: whether the host can be paid has
  // no bearing on what the renter can pay with. See `collectsLocally`.
  if (collectsLocally(countryCode)) return ['card', 'momo', 'bank'];
  if (countryCode === 'CN') return ['alipay', 'wechat_pay', 'card'];
  // Venmo and Cash App are not here because neither is a way a renter pays us.
  //
  // The wallets that ARE here are a collection-side question and PayHold's own
  // to answer (`collectionOptionsFor` → `CollectionOptions.methods`), which is
  // why they are left alone. Worth knowing while reading them: on the PAYOUT
  // side these same brands are dead ends — see `payoutMethodsFor` — and PayPal
  // collection is built-but-disabled on PayHold today, so this fallback is
  // probably optimistic here too.
  return ['card', 'paypal', 'bank'];
}

export const PAYMENT_METHOD_META: Record<
  PaymentMethodType,
  { label: string; blurb: string; field: string; placeholder: string }
> = {
  card: {
    label: 'Card',
    // Not "charged at pickup": the hold funds the deal at booking and is
    // released when both sides confirm the car came back. Capturing later is a
    // different lifecycle (deposit → capture) that AutoHire does not use.
    blurb: 'Visa, Mastercard, Amex. Held when you book, released after the trip.',
    field: 'Card number',
    placeholder: '4242 4242 4242 4242',
  },
  momo: {
    label: 'Mobile Money',
    blurb: 'MTN MoMo or Airtel Money. You approve each payment on your phone.',
    field: 'Mobile money number',
    placeholder: '+250 788 123 456',
  },
  bank: {
    label: 'Bank account',
    blurb: 'Direct debit from your bank account.',
    field: 'Bank account number',
    placeholder: 'Account number',
  },
  paypal: {
    label: 'PayPal',
    blurb: 'Approve each booking from your PayPal account.',
    field: 'PayPal email',
    placeholder: 'you@example.com',
  },
  alipay: {
    label: 'Alipay',
    blurb: 'Scan to approve each booking in the Alipay app.',
    field: 'Alipay email or phone',
    placeholder: 'you@example.com',
  },
  wechat_pay: {
    label: 'WeChat Pay',
    blurb: 'Scan to approve each booking in WeChat.',
    field: 'WeChat ID or phone',
    placeholder: '+86 138 0013 8000',
  },
};

/** "Card · ••••4242" style label for a saved payment method. */
export function paymentLabel(method: PaymentMethodType, dest: string): string {
  return `${PAYMENT_METHOD_META[method].label} · ${maskDestination(dest)}`;
}

/** Mask all but the last 4 characters of a destination — never store the full value raw. */
export function maskDestination(dest: string): string {
  const s = dest.replace(/\s+/g, '');
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
}

/** "MTN MoMo · ••••3456" style label for the connected method. */
export function payoutLabel(method: PayoutMethodType, dest: string): string {
  return `${PAYOUT_METHOD_META[method].label} · ${maskDestination(dest)}`;
}


/**
 * Is this a destination PayPal will actually accept?
 *
 * Mirrors PayHold's own rule rather than inventing a looser one, because the
 * only thing a weaker check here buys is the same refusal arriving later and
 * from further away: an account email (`user@domain`, with a dot in the
 * domain), or a payer id of 9–20 alphanumerics. PayHold rejects bank details
 * outright with "A PayPal destination is an account email or a payer id, not
 * bank details", and the generic `length >= 4` gate on the form would have
 * happily submitted `ab@c`.
 *
 * Deliberately not a full RFC 5322 email test. That grammar accepts addresses
 * no payout rail will take and rejects nothing a host is likely to type by
 * accident; the failure worth catching here is a half-typed address or a bank
 * account number, and both of those this catches.
 */
export function isPayPalDestination(value: string): boolean {
  const v = value.trim();
  if (/^[A-Za-z0-9]{9,20}$/.test(v)) return true; // payer id
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v); // account email
}
