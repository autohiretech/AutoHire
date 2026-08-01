import type { PayoutMethodType, PayoutProvider } from '@autohire/shared';

/**
 * Payment orchestration — the user picks a method they understand (mobile money,
 * bank, card); the SYSTEM decides which rail moves the money. Flutterwave is the
 * workhorse for Africa (collections + payouts to MoMo/bank); Stripe handles
 * international cards and cross-border payouts. Nothing here exposes the provider
 * to the user — it's an implementation detail routed on method + country.
 */

/** Markets Flutterwave settles locally (MoMo + bank). Extend as you add markets. */
const FLUTTERWAVE_COUNTRIES = new Set(['RW', 'KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'CI']);

/** Which provider handles a host PAYOUT for a given method + country. */
export function payoutProviderFor(method: PayoutMethodType, countryCode: string): PayoutProvider {
  if (method === 'momo') return 'flutterwave'; // mobile money is African → Flutterwave
  if (method === 'card') return 'stripe'; // push-to-card / international → Stripe
  // bank: Flutterwave locally in Africa, Stripe for everywhere else.
  return FLUTTERWAVE_COUNTRIES.has(countryCode) ? 'flutterwave' : 'stripe';
}

/** Which provider collects a renter PAYMENT for a method + the card's/payer's country. */
export function collectionProviderFor(
  method: 'card' | 'momo',
  countryCode: string,
): PayoutProvider {
  if (method === 'momo') return 'flutterwave';
  // Cards: Flutterwave for African cards, Stripe for international.
  return FLUTTERWAVE_COUNTRIES.has(countryCode) ? 'flutterwave' : 'stripe';
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
