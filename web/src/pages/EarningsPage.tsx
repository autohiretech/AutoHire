import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  Lock,
  Wallet,
} from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatMoney, type CurrencyCode } from '@/lib/currency';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Badge, Button, Card, CardBody, CardHeader, Spinner, toast } from '@/components/ui';

/** Currencies with no minor unit — PayHold sends these as-is, not ×100. */
const ZERO_DECIMAL = new Set(['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);

/**
 * PayHold speaks minor units (integers, always) and `formatMoney` takes major.
 * Getting this wrong shows a host 100× their balance, so it goes through one
 * function rather than being inlined at each of the six call sites.
 */
function money(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const zero = ZERO_DECIMAL.has(code);
  return formatMoney(zero ? minor : minor / 100, code as CurrencyCode, {
    decimals: zero ? 0 : 2,
  });
}

/**
 * A host's money: what is held, what is clearing, what they can take now.
 *
 * Every figure is read live from PayHold, which owns the ledger. AutoHire keeps
 * no copy — a cached balance drifts the first time a webhook is missed, and a
 * host who sees money that is not there makes plans against it.
 */
export function EarningsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();

  const { data: wallet, isLoading, error } = useQuery({
    queryKey: ['payholdWallet'],
    queryFn: () => client.payholdBalance(),
    // Money moves on PayHold's clock, not on ours. Refetching on focus is how a
    // host who leaves the tab open overnight sees a cleared payout in the
    // morning without reloading.
    refetchOnWindowFocus: true,
  });

  const withdraw = useMutation({
    mutationFn: () => client.payholdWithdraw(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['payholdWallet'] });
      toast.success(r.message);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't withdraw."),
  });

  const isHost = me?.role === 'owner';

  if (me && !isHost) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-ink-900">Earnings are for hosts</h1>
        <p className="mt-2 text-sm text-ink-600">
          List a car to start earning. Renters don't have a payout balance.
        </p>
        <Button className="mt-5" onClick={() => navigate('/cars/new')}>
          List a car
        </Button>
      </section>
    );
  }

  // One row per currency. A host with cars in two markets genuinely has two
  // balances, and adding them together would invent an exchange rate nobody
  // agreed to.
  const balances = wallet?.balances ?? [];
  const withdrawable = wallet?.withdrawable ?? [];
  const canWithdraw = withdrawable.some((w) => w.availableAmount > 0);

  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <Wallet size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Earnings</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Money from your trips, and what you can withdraw right now.
          </p>
        </div>
      </div>

      {isLoading && (
        <Card className="mt-6">
          <CardBody className="flex justify-center py-10">
            <Spinner size={22} />
          </CardBody>
        </Card>
      )}

      {error && (
        <Card className="mt-6 border-red-200 bg-red-50/50">
          <CardBody className="text-sm text-red-700">
            Couldn't load your balance. {error instanceof Error ? error.message : ''}
          </CardBody>
        </Card>
      )}

      {/* No payout destination yet — the wallet is empty because nothing can
          reach it, so say that rather than showing a row of zeroes. */}
      {wallet && !wallet.sellerId && (
        <Card className="mt-6 border-amber-200 bg-amber-50/60">
          <CardBody className="space-y-3">
            <div>
              <p className="font-medium text-ink-900">Set up payouts to start earning</p>
              <p className="mt-0.5 text-sm text-ink-600">
                Your trips can't pay out until we know where to send the money.
              </p>
            </div>
            <Button onClick={() => navigate('/payouts/setup')}>
              <Banknote size={16} /> Add a payout method
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Things stopping money from moving. Shown before the figures, because a
          host with a blocked payout needs the reason more than the number. */}
      {wallet?.sellerId && !wallet.canReceivePayouts && (
        <Card className="mt-6 border-amber-200 bg-amber-50/60">
          <CardBody className="space-y-2">
            <p className="flex items-center gap-2 font-medium text-ink-900">
              <AlertTriangle size={16} className="text-amber-600" />
              Payouts are on hold
            </p>
            {wallet.reasons.length > 0 && (
              <ul className="ml-1 list-inside list-disc text-sm text-ink-700">
                {wallet.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {wallet.routeReasons.length > 0 && (
              <>
                <p className="pt-1 text-sm font-medium text-ink-700">On our side:</p>
                <ul className="ml-1 list-inside list-disc text-sm text-ink-600">
                  {wallet.routeReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {balances.map((b) => (
        <Card key={b.currency} className="mt-6">
          <CardHeader className="flex items-center justify-between">
            <h2 className="font-semibold text-ink-900">{b.currency}</h2>
            <Badge tone="neutral">{b.currency}</Badge>
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Figure
              icon={Lock}
              label="On trips"
              value={money(b.held, b.currency)}
              hint="Held while the trip runs"
              tone="neutral"
            />
            <Figure
              icon={Clock}
              label="Clearing"
              value={money(b.pendingClearance, b.currency)}
              hint="Yours, inside the safety window"
              tone="amber"
            />
            <Figure
              icon={CheckCircle2}
              label="Available"
              value={money(b.available, b.currency)}
              hint="Ready to withdraw"
              tone="emerald"
            />
          </CardBody>
        </Card>
      ))}

      {/* What a withdrawal would actually move — in the host's OWN payout
          currency, which on a cross-border trip is not the currency above. */}
      {withdrawable.map((w) => (
        <Card key={`w-${w.currency}`} className="mt-4 border-emerald-200 bg-emerald-50/40">
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-ink-600">Ready to send to your account</p>
              <p className="text-2xl font-bold text-ink-900">
                {money(w.availableAmount, w.currency)}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                {w.availableCount} trip{w.availableCount === 1 ? '' : 's'}
                {w.clearingAmount > 0 &&
                  ` · ${money(w.clearingAmount, w.currency)} still clearing`}
                {w.requestedCount > 0 && ` · ${w.requestedCount} already on the way`}
              </p>
              {(w.heldCount > 0 || w.needsVerificationCount > 0 || w.blockedCount > 0) && (
                <p className="mt-1 text-xs text-amber-700">
                  {[
                    w.heldCount > 0 && `${w.heldCount} on hold`,
                    w.needsVerificationCount > 0 &&
                      `${w.needsVerificationCount} needs verification`,
                    w.blockedCount > 0 && `${w.blockedCount} blocked`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            <Button
              disabled={!canWithdraw || withdraw.isPending || !wallet?.canReceivePayouts}
              onClick={() => withdraw.mutate()}
            >
              <Banknote size={16} />
              {withdraw.isPending ? 'Sending…' : 'Send it now'}
            </Button>
          </CardBody>
        </Card>
      ))}

      {wallet?.sellerId && balances.length === 0 && !isLoading && (
        <Card className="mt-6">
          <CardBody className="py-10 text-center">
            <p className="font-medium text-ink-900">No earnings yet</p>
            <p className="mt-1 text-sm text-ink-500">
              Money from your first completed trip will show up here.
            </p>
          </CardBody>
        </Card>
      )}

      <p className="mt-6 text-xs text-ink-500">
        Money is held while a trip runs and released when you and the renter both confirm the car
        came back. It then clears before it can be sent.{' '}
        <span className="font-medium text-ink-600">
          Cleared money is paid out to you automatically
        </span>{' '}
        — use “Send it now” only if you want it sooner, or to retry a payout that didn't go
        through.
      </p>
    </section>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Lock;
  label: string;
  value: string;
  hint: string;
  tone: 'neutral' | 'amber' | 'emerald';
}) {
  return (
    <div>
      <p
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          tone === 'emerald' && 'text-emerald-700',
          tone === 'amber' && 'text-amber-700',
          tone === 'neutral' && 'text-ink-500',
        )}
      >
        <Icon size={14} /> {label}
      </p>
      <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
    </div>
  );
}
