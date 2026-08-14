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

/** Currencies with no minor unit — PayHold sends these as-is, not ×100. */
const ZERO_DECIMAL_MINOR = new Set(['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);

/**
 * Format an amount PayHold quoted in minor units (integers, always — 1000 =
 * 10.00) as major-unit money. Getting this wrong shows 100× the real amount,
 * so every PayHold amount (deals, payouts, balances) goes through this one
 * function rather than being converted inline at each call site.
 */
export function formatMoneyMinor(minor: number, code: string): string {
  const upper = code.toUpperCase();
  const zero = ZERO_DECIMAL_MINOR.has(upper);
  return formatMoney(zero ? minor : minor / 100, upper, { decimals: zero ? 0 : 2 });
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
  const meta = (code in CURRENCIES ? CURRENCIES[code as CurrencyCode] : CURRENCIES.USD) ?? CURRENCIES.USD;
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
