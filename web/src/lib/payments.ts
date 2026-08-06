import type { PayoutMethodType, PayoutProvider } from '@autohire/shared';

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
  if (PAYMENTS_EXTERNAL) return 'external';
  return isAfricanMarket(carCountryCode) ? 'flutterwave' : 'stripe';
}

/** Which provider a host's payout method routes to (matches their market). */
export function payoutProviderFor(method: PayoutMethodType, countryCode: string): PayoutProvider {
  if (PAYMENTS_EXTERNAL) return 'external';
  if (method === 'momo') return 'flutterwave'; // mobile money is African → Flutterwave
  if (method === 'card') return 'stripe'; // push-to-card / international → Stripe
  return isAfricanMarket(countryCode) ? 'flutterwave' : 'stripe';
}

/** The payout methods offered in a given market (MoMo only where it exists). */
export function payoutMethodsFor(countryCode: string): PayoutMethodType[] {
  return FLUTTERWAVE_COUNTRIES.has(countryCode) ? ['momo', 'bank'] : ['bank', 'card'];
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

/** Mask all but the last 4 characters of a destination — never store the full value raw. */
export function maskDestination(dest: string): string {
  const s = dest.replace(/\s+/g, '');
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
}

/** "MTN MoMo · ••••3456" style label for the connected method. */
export function payoutLabel(method: PayoutMethodType, dest: string): string {
  return `${PAYOUT_METHOD_META[method].label} · ${maskDestination(dest)}`;
}
