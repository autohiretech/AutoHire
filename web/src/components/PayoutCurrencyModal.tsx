import { useQuery } from '@tanstack/react-query';

import { client } from '@/lib/client';
import { methodNamesFor } from '@/lib/payments';
import { Modal, Notice, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Which currency a host wants their earnings paid in.
 *
 * **Asked here, not while adding a destination.** Adding a destination
 * answers "where does my money land" — an account is in a country, and being
 * asked to pick a currency mid-way through typing an account number is a
 * second, unrelated question. Choosing a currency is a decision about money
 * that already exists, so it belongs beside the balance.
 *
 * The list is PayHold's `payout.currencies` for the host's country, never a
 * constant here: eligibility is per (country, currency) and the methods each
 * one reaches differ — a Kenyan host paid in KES gets mobile money, the same
 * host paid in USD gets PayPal. `currencies_unavailable` explains the ones a
 * host might have expected and cannot have, so an absent dollar is answered
 * rather than simply missing.
 *
 * Picking one does not change anything by itself. PayHold has no route that
 * restates an existing destination's currency, and AutoHire never keeps the
 * raw account number — so the destination has to be registered again, and the
 * caller opens the payout form seeded with the choice.
 */
export function PayoutCurrencyModal({
  open,
  onClose,
  country,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  country: string;
  /** What they are paid in today, so the list can say which one that is. */
  current: string | null;
  onPick: (currency: string) => void;
}) {
  const { data: route, isLoading } = useQuery({
    queryKey: ['payholdPayoutRoute', country, 'currency-picker', current],
    // The host's own currency is named so that if it has stopped being
    // offered, they are told why rather than finding it quietly gone.
    queryFn: () =>
      client.payholdPayoutRoute(country, {
        explain: [...new Set(['USD', 'EUR', ...(current ? [current] : [])])],
      }),
    enabled: open && !!country,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const available = route?.payout?.currencies ?? [];
  const unavailable = route?.payout?.currencies_unavailable ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Get paid in">
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      )}

      {!isLoading && available.length === 0 && (
        <Notice tone="warn">
          We couldn't load the currencies for your market just now. Your existing payout method is
          unaffected — try again in a moment.
        </Notice>
      )}

      {!isLoading && available.length > 0 && (
        <>
          {/* With one payout account per host, re-registering for a new
              currency replaces the current account rather than adding a
              second — say so before they pick, not after they save. */}
          <p className="mb-3 text-body-sm text-[var(--color-content-muted)]">
            Changing this means entering your payout details once more — we never store your full
            account number, so there is nothing for us to move across on your behalf. You can have
            one payout account, so the new one replaces your current one, and payouts can pause
            while it is verified.
          </p>
          <ul className="space-y-2">
            {available.map((c) => {
              const isCurrent = c.currency === current;
              return (
                <li key={c.currency}>
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => onPick(c.currency)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-left',
                      isCurrent
                        ? 'border-[var(--color-accent-on)] bg-[var(--color-surface-sunken)]'
                        : 'border-[var(--color-line)] hover:bg-[var(--color-surface-sunken)]',
                    )}
                  >
                    <span className="font-semibold text-[var(--color-content)]">{c.currency}</span>
                    <span className="flex-1 text-caption text-[var(--color-content-muted)]">
                      {methodNamesFor(c.methods)}
                    </span>
                    {isCurrent && (
                      <span className="text-caption font-medium text-[var(--color-accent-on)]">
                        Current
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {unavailable.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {unavailable.map((u) => (
                <li
                  key={u.currency}
                  className="flex gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--color-line)] px-3 py-2 text-caption text-[var(--color-content-muted)]"
                >
                  <span className="font-semibold text-[var(--color-content-subtle)]">
                    {u.currency}
                  </span>
                  {/* PayHold's sentence states the market fact and stops — it
                      does not know this host's situation. The clause that
                      matters is theirs being the one they are paid in today. */}
                  <span className="flex-1">
                    {u.message}
                    {u.currency === current && (
                      <>
                        {' '}
                        <span className="font-medium text-[var(--color-content)]">
                          This is what you are paid in today, so it needs changing.
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
