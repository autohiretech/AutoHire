import type { PaymentMethodType, PayoutMethodType, PayoutProvider } from '@autohire/shared';

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

/** Markets Flutterwave settles locally (MoMo + bank). Extend as you add markets. */
const FLUTTERWAVE_COUNTRIES = new Set(['RW', 'KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'CI']);

/** Is this an African market whose money lands as a local currency (MoMo/bank)? */
export function isAfricanMarket(countryCode: string): boolean {
  return FLUTTERWAVE_COUNTRIES.has(countryCode);
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

/** The payout methods offered in a given market (MoMo only where it exists). */
export function payoutMethodsFor(countryCode: string): PayoutMethodType[] {
  return FLUTTERWAVE_COUNTRIES.has(countryCode) ? ['momo', 'bank'] : ['bank', 'card'];
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
  /** PayHold reaches it, but only via Stripe Connect, which AutoHire lacks. */
  | { state: 'unsupported' };

export function payoutAvailability(
  countryCode: string,
  known: PayoutCountry | null | undefined,
): PayoutAvailability {
  // No answer from PayHold — a cold cache, or the function is not deployed.
  // Fall back to the old list rather than blocking a host who may be perfectly
  // payable; being wrong the way we were before is better than a dead screen.
  if (!known) return { state: 'ok', methods: payoutMethodsFor(countryCode) };

  if (known.restricted) return { state: 'restricted' };
  if (!known.can_payout) return { state: 'unavailable', reason: known.closed_reason };

  // Reachable, and reachable with a number the host can type. These are the
  // corridors Flutterwave settles, and the only ones registration works in.
  if (FLUTTERWAVE_COUNTRIES.has(countryCode)) return { state: 'ok', methods: ['momo', 'bank'] };

  return { state: 'unsupported' };
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
  return isAfricanMarket(countryCode) ? ['card', 'momo'] : ['card'];
}

export const PAYMENT_METHOD_META: Record<
  PaymentMethodType,
  { label: string; blurb: string; field: string; placeholder: string }
> = {
  card: {
    label: 'Card',
    blurb: 'Visa, Mastercard, Amex. Held at booking, charged at pickup.',
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
