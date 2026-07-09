import { useCountry } from '@/lib/country';
import { useFxRates, convert } from '@/lib/fx';
import { formatMoney, isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import { cn } from '@/lib/cn';

/**
 * Renders a money amount in the shopper's selected display currency (from the
 * header country selector), converting from the listing's native currency via
 * live FX rates. When the two differ we prefix "≈" (it's an estimate — the car
 * is charged in its home currency) and optionally show the native price beneath.
 */
export function Price({
  amount,
  currency: rawCurrency,
  className,
  showNative = false,
}: {
  amount: number;
  /** The listing's native currency (what it's actually priced/charged in). */
  currency: string;
  className?: string;
  showNative?: boolean;
}) {
  const { country } = useCountry();
  const fx = useFxRates();
  const display = country.currency;
  // Listings pre-date multi-currency; anything unknown/undefined is RWF.
  const currency: CurrencyCode = isCurrencyCode(rawCurrency) ? rawCurrency : 'RWF';

  const converted = convert(amount, currency, display, fx);
  // If we can't convert (missing rate), just show the native price as-is.
  const shown = converted ?? amount;
  const shownCurrency: CurrencyCode = converted === null ? currency : display;
  const isEstimate = shownCurrency !== currency;

  return (
    <span className={className}>
      <span className={cn(isEstimate && 'text-ink-900')}>
        {isEstimate && <span className="text-ink-400">≈ </span>}
        {formatMoney(shown, shownCurrency)}
      </span>
      {showNative && isEstimate && (
        <span className="ml-1 text-xs font-normal text-ink-400">
          ({formatMoney(amount, currency)})
        </span>
      )}
    </span>
  );
}
