import { useCountry } from '@/lib/country';
import { useFxRates, convert } from '@/lib/fx';
import { formatMoney, isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import { cn } from '@/lib/cn';

/**
 * Renders a money amount in the shopper's selected display currency.
 *
 * Three different currencies exist in this app and conflating them is how a
 * payment UI misleads someone, so to be explicit about which one this is:
 *
 *   1. The listing's own currency (`Listing.priceCurrency`) — what the host
 *      prices in and is owed. `amount`/`currency` here.
 *   2. The DISPLAY currency (header selector) — this component. Converted via
 *      live FX purely so a visitor can read the price in something familiar.
 *      It changes no charge, anywhere.
 *   3. The PRESENTMENT currency — what the renter is actually charged, picked
 *      at checkout (`PayholdPayment`'s "Pay in" select, which defaults to the
 *      listing's own currency, NOT to this one).
 *
 * So a figure rendered here is never what someone will be billed unless (1),
 * (2) and (3) happen to coincide. When display differs from native we prefix
 * "≈" and explain the rest on hover — see `explain` below.
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
  const { currency: display } = useCountry();
  const fx = useFxRates();
  // Listings pre-date multi-currency; anything unknown/undefined is RWF.
  const currency: CurrencyCode = isCurrencyCode(rawCurrency) ? rawCurrency : 'RWF';

  const converted = convert(amount, currency, display, fx);
  // If we can't convert (missing rate), just show the native price as-is.
  const shown = converted ?? amount;
  const shownCurrency: string = converted === null ? currency : display;
  const isEstimate = shownCurrency !== currency;
  // Asked for a different currency but no rate exists, so this is the car's
  // own price while the header still says otherwise. Rare — 166 currencies
  // have rates — but it resolves silently, and a price that quietly ignores
  // the currency you picked is worth one sentence of explanation on hover.
  const unconverted = converted === null && display !== currency;

  // `showNative` is off in most places, so the ≈ figure is often the ONLY
  // price on screen and nothing names the currency the car is actually
  // priced in. The symbol says "approximate" without saying approximate to
  // what. This does not change any layout — it just means the answer is
  // available to anyone who looks, and to screen readers via the same text.
  const explain = isEstimate
    ? `Estimate, converted for display. This car is priced in ${currency}: ${formatMoney(amount, currency)}. You choose the currency you pay in at checkout.`
    : unconverted
      ? `No live ${display} rate, so this shows the car's own price in ${currency}.`
      : undefined;

  return (
    <span className={cn('tabular', className)} title={explain}>
      <span className={cn(isEstimate && 'text-[var(--color-content)]')}>
        {isEstimate && (
          <span className="text-[var(--color-content-subtle)]" aria-hidden="true">
            ≈{' '}
          </span>
        )}
        {isEstimate && <span className="sr-only">Approximately </span>}
        {formatMoney(shown, shownCurrency)}
      </span>
      {showNative && isEstimate && (
        <span className="ml-1 text-caption font-normal text-[var(--color-content-subtle)]">
          ({formatMoney(amount, currency)})
        </span>
      )}
    </span>
  );
}
