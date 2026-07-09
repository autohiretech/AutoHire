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
 * Format an amount in the given currency, e.g. `formatMoney(45000, 'RWF')` →
 * "RWF 45,000", `formatMoney(1200, 'CNY')` → "CN¥ 1,200". Daily rental prices
 * are whole numbers, so converted estimates round to 0 decimals by default;
 * pass `{ decimals: meta.decimals }` when you need the currency's exact minor
 * units (e.g. a final charged amount).
 */
export function formatMoney(
  amount: number,
  code: CurrencyCode,
  opts: { decimals?: number } = {},
): string {
  const meta = CURRENCIES[code] ?? CURRENCIES.USD;
  const decimals = opts.decimals ?? 0;
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    // Very old runtimes without the currency in ICU: fall back to code + number.
    return `${code} ${amount.toLocaleString()}`;
  }
}
