import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { BASE_CURRENCY, type CurrencyCode } from '@/lib/currency';

/**
 * Foreign-exchange rates, quoted against USD (1 USD = `rates[code]` units of
 * `code`). Refreshed once a day by the `refresh-fx-rates` Edge Function into the
 * `fx_rates` table (see supabase/migration-022). The browser reads the cached
 * table — it never calls an FX provider directly.
 */
export interface FxRates {
  /** The currency all rates are quoted against — always `BASE_CURRENCY` ('USD'). */
  base: string;
  /** ISO date the rates were sourced (e.g. "2026-07-08"). */
  asOf: string;
  /** units of each currency per 1 unit of `base`. */
  rates: Record<string, number>;
}

/** Last-resort static rates so prices still render if `fx_rates` is empty. */
const FALLBACK: FxRates = {
  base: BASE_CURRENCY,
  asOf: 'default',
  rates: { USD: 1, RWF: 1300, AED: 3.67, CNY: 7.2 },
};

export function useFxRates() {
  const query = useQuery({
    queryKey: ['fx-rates'],
    queryFn: () => client.getFxRates(),
    staleTime: 60 * 60 * 1000, // an hour — rates only move daily
    // Rates are non-critical chrome; if the table read fails, show fallbacks.
    placeholderData: FALLBACK,
  });
  return query.data ?? FALLBACK;
}

/**
 * Convert an `amount` from one currency to another using USD-based rates.
 * Returns `null` when either side has no rate (caller shows the native price).
 */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  fx: FxRates,
): number | null {
  if (from === to) return amount;
  const fromRate = fx.rates[from];
  const toRate = fx.rates[to];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}
