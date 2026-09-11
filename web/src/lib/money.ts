import { CURRENCIES, formatMoney, isCurrencyCode } from '@/lib/currency';

/**
 * The currency a booking's (and its payout's) amounts are actually in.
 *
 * Every `*Rwf` amount on a booking or payout — subtotal, service fee, total,
 * final, owed, exceeded, the per-hour and overage snapshots — is computed
 * from the car's own price, and a car is priced in `listing.priceCurrency`
 * (a Dubai car in AED, a Shanghai car in CNY). The `Rwf` suffix is a leftover
 * from when the catalogue was Rwanda-only, not a unit. So the car's currency
 * decides, then what the booking recorded as charged (PayHold sets that to the
 * deal's currency, which is the car's), and RWF only for rows with neither.
 */
export function bookingCurrency(
  booking: { chargeCurrency?: string },
  listing?: { priceCurrency?: string } | null,
): string {
  return (listing?.priceCurrency || booking.chargeCurrency || 'RWF').toUpperCase();
}

/** An amount in its own currency, at that currency's natural precision. */
export function formatAmount(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  return isCurrencyCode(code)
    ? formatMoney(amount, code, { decimals: CURRENCIES[code].decimals })
    : formatMoney(amount, code);
}

/** Totals kept apart per currency — AED and RWF are never added together. Largest first. */
export function sumByCurrency(
  items: { amount: number; currency: string }[],
): { currency: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const { amount, currency } of items) {
    const code = currency.toUpperCase();
    totals.set(code, (totals.get(code) ?? 0) + amount);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** "AED 1,200 · RWF 45,000", or a zero in `fallback` when there is nothing to total. */
export function formatTotals(totals: { currency: string; amount: number }[], fallback = 'RWF'): string {
  if (totals.length === 0) return formatAmount(0, fallback);
  return totals.map((t) => formatAmount(t.amount, t.currency)).join(' · ');
}
