/**
 * Currency metadata + formatting for AutoHire's multi-country marketplace.
 *
 * Every listing is priced in its own local currency (`Listing.priceCurrency`).
 * The header country selector picks the *display* currency; prices are converted
 * for display via live FX rates (see `fx.tsx`) but a car is still charged in its
 * home currency at checkout. `USD` is the base every FX rate is expressed against.
 */

// AutoHire operates in three markets — Rwanda, Dubai (UAE), China — plus USD as
// the base every FX rate is quoted against.
export type CurrencyCode = 'USD' | 'RWF' | 'AED' | 'CNY';

export interface CurrencyMeta {
  code: CurrencyCode;
  /** BCP-47 locale used for grouping/symbol placement. */
  locale: string;
  /** Natural minor-unit digits for this currency (0 for RWF/UGX, 2 for USD). */
  decimals: number;
}

/** The base every stored FX rate is quoted against (1 USD = rate × currency). */
export const BASE_CURRENCY: CurrencyCode = 'USD';

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: 'USD', locale: 'en-US', decimals: 2 },
  RWF: { code: 'RWF', locale: 'en-RW', decimals: 0 },
  AED: { code: 'AED', locale: 'en-AE', decimals: 0 },
  CNY: { code: 'CNY', locale: 'zh-CN', decimals: 0 },
};

export function isCurrencyCode(v: string): v is CurrencyCode {
  return v in CURRENCIES;
}

/**
 * How many minor units a currency has — asked of the platform, never listed here.
 *
 * This was a seven-item set of zero-decimal codes, and everything absent from
 * it was assumed to be ×100. **The set of currencies on this page comes from
 * PayHold** — a balance, a withdrawable row and a payout destination each name
 * their own — so the list here had no way to stay in step with it, and the
 * failure is silent and in money: BIF is zero-decimal and was not in the set,
 * so a Burundian host's BIF 500,000 rendered as "BIF 5,000", a hundredth of
 * what they are owed, on the one screen that tells them what they have. KWD,
 * BHD and TND have *three* minor digits and rendered ten times too high.
 *
 * ICU already carries the ISO 4217 exponent for every currency it knows, which
 * is the same table a list here would be copied from, so it is asked directly.
 * The four markets AutoHire sells in resolve exactly as the old set did —
 * RWF 0, USD 2, AED 2, CNY 2 — so nothing on screen today moves; what changes
 * is that the next currency PayHold pays in is right without an edit here.
 *
 * The old set survives only as the fallback for a runtime whose ICU does not
 * know the code at all, which is also the case where `Intl` throws.
 */
const ZERO_DECIMAL_FALLBACK = new Set(['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);

/** Resolved exponents, so a list rendering many rows asks ICU once per code. */
const minorDigitsCache = new Map<string, number>();

export function minorUnitDigits(code: string): number {
  const upper = code.toUpperCase();
  const cached = minorDigitsCache.get(upper);
  if (cached !== undefined) return cached;
  let digits: number;
  try {
    // For `style: 'currency'` ICU sets min and max fraction digits to the
    // currency's own exponent, which is the figure this needs.
    // Typed optional: a runtime that resolves the format but reports no
    // digit count falls back the same way an unknown code does.
    digits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: upper }).resolvedOptions()
        .maximumFractionDigits ?? (ZERO_DECIMAL_FALLBACK.has(upper) ? 0 : 2);
  } catch {
    // Not a code ICU recognises (or a very old runtime): the old assumption.
    digits = ZERO_DECIMAL_FALLBACK.has(upper) ? 0 : 2;
  }
  minorDigitsCache.set(upper, digits);
  return digits;
}

/**
 * Format an amount PayHold quoted in minor units (integers, always — 1000 =
 * 10.00) as major-unit money. Getting this wrong shows 100× the real amount,
 * so every PayHold amount (deals, payouts, balances) goes through this one
 * function rather than being converted inline at each call site.
 */
export function formatMoneyMinor(minor: number, code: string): string {
  const upper = code.toUpperCase();
  const digits = minorUnitDigits(upper);
  return formatMoney(minor / 10 ** digits, upper, { decimals: digits });
}

/**
 * The same conversion as a number rather than a string, for arithmetic that
 * has to happen in major units.
 *
 * An exchange rate is the case this exists for: minor units cancel in a ratio
 * only when both currencies share an exponent, and RWF (0) and USD (2) do not
 * — dividing the two minor figures would report a rate a hundred times out.
 * Exported so that arithmetic resolves the exponent through `minorUnitDigits`
 * here rather than keeping its own idea of it, which is how two of them drift
 * apart.
 */
export function majorUnits(minor: number, code: string): number {
  return minor / 10 ** minorUnitDigits(code);
}

/**
 * Format an amount in the given currency, e.g. `formatMoney(45000, 'RWF')` →
 * "RWF 45,000", `formatMoney(1200, 'CNY')` → "CN¥ 1,200". Daily rental prices
 * are whole numbers, so converted estimates round to 0 decimals by default;
 * pass `{ decimals: meta.decimals }` when you need the currency's exact minor
 * units (e.g. a final charged amount).
 */
export function formatMoney(
  amount: number,
  code: string,
  opts: { decimals?: number } = {},
): string {
  const upper = code.toUpperCase();
  // `CURRENCIES` is the four markets AutoHire *sells* in, and it is the right
  // list for that — but PayHold pays in whatever the host's destination takes,
  // which is a different and open set. A currency from there used to borrow
  // en-US, so a Kenyan host's KES was grouped and placed the American way for
  // no better reason than USD being first in this map. An unknown code gets no
  // locale at all instead, which asks the runtime for the reader's own.
  const locale = upper in CURRENCIES ? CURRENCIES[upper as CurrencyCode].locale : undefined;
  const decimals = opts.decimals ?? 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: upper,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    // Very old runtimes without the currency in ICU: fall back to code + number.
    return `${upper} ${amount.toLocaleString()}`;
  }
}
