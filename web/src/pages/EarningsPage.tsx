import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  Hourglass,
  Lock,
  Send,
  ShieldAlert,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { EarningStage, EarningTrip, PayoutDestination } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatMoney, type CurrencyCode } from '@/lib/currency';
import { formatDate } from '@/lib/format';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Badge, Button, Card, CardBody, CardHeader, Spinner, toast } from '@/components/ui';

/** Currencies with no minor unit — PayHold sends these as-is, not ×100. */
const ZERO_DECIMAL = new Set(['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);

/**
 * PayHold speaks minor units (integers, always) and `formatMoney` takes major.
 * Getting this wrong shows a host 100× their balance, so it goes through one
 * function rather than being inlined at each call site.
 */
function money(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const zero = ZERO_DECIMAL.has(code);
  return formatMoney(zero ? minor : minor / 100, code as CurrencyCode, {
    decimals: zero ? 0 : 2,
  });
}

/**
 * Every stage a host's money passes through, in order, each said plainly.
 *
 * `hint` is written to answer "so what do I do?" — a stage a host can't act on
 * says who they're waiting for, and a stage they can says so.
 */
const STAGES: Record<
  EarningStage,
  { label: string; hint: string; icon: typeof Lock; tone: 'ink' | 'amber' | 'emerald' | 'red' }
> = {
  awaiting_payment: {
    label: 'Awaiting payment',
    hint: "The renter hasn't finished paying yet.",
    icon: Hourglass,
    tone: 'ink',
  },
  on_trip: {
    label: 'On trip',
    hint: 'Held safely while the car is out. Not yours yet.',
    icon: Lock,
    tone: 'ink',
  },
  awaiting_confirmation: {
    label: 'Needs confirming',
    hint: 'The trip is done. Money is released once you and the renter both confirm.',
    icon: AlertTriangle,
    tone: 'amber',
  },
  clearing: {
    label: 'Clearing',
    hint: "Yours now — inside the safety window before it can be sent.",
    icon: Clock,
    tone: 'amber',
  },
  ready: {
    label: 'Ready to send',
    hint: 'Cleared. It goes out automatically, or you can send it now.',
    icon: CheckCircle2,
    tone: 'emerald',
  },
  sending: { label: 'Sending', hint: 'On its way to your account.', icon: Send, tone: 'emerald' },
  paid: { label: 'Paid', hint: 'In your account.', icon: Banknote, tone: 'emerald' },
  on_hold: {
    label: 'On hold',
    hint: 'Something stopped this payout.',
    icon: ShieldAlert,
    tone: 'red',
  },
  disputed: {
    label: 'In dispute',
    hint: 'This trip is being resolved. The payout is frozen until it is settled.',
    icon: ShieldAlert,
    tone: 'red',
  },
  refunded: {
    label: 'Refunded',
    hint: 'The money went back to the renter.',
    icon: Undo2,
    tone: 'red',
  },
  cancelled: { label: 'Cancelled', hint: 'No money moved.', icon: XCircle, tone: 'ink' },
};

/**
 * A host's money: the totals, every trip that made them, and where it goes.
 *
 * Everything is read live from PayHold, which owns the ledger. AutoHire keeps no
 * copy — a cached balance drifts the first time a webhook is missed, and a host
 * who sees money that is not there makes plans against it.
 */
export function EarningsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [destinationId, setDestinationId] = useState<string | null>(null);

  const wallet = useQuery({
    queryKey: ['payholdWallet'],
    queryFn: () => client.payholdBalance(),
    // Money moves on PayHold's clock, not ours. Refetching on focus is how a
    // host who left the tab open overnight sees a cleared payout in the morning.
    refetchOnWindowFocus: true,
  });

  const earnings = useQuery({
    queryKey: ['payholdEarnings'],
    queryFn: () => client.payholdEarnings(0),
  });

  const withdraw = useMutation({
    mutationFn: () => client.payholdWithdraw(destinationId ?? undefined),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['payholdWallet'] });
      queryClient.invalidateQueries({ queryKey: ['payholdEarnings'] });
      toast.success(r.message);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send your money."),
  });

  if (me && me.role !== 'owner') {
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

  // The Edge Functions answer 503 'not_configured' until the PayHold secrets
  // are set. Detected from the message because supabase-js collapses a non-2xx
  // into a FunctionsHttpError without surfacing our body's `code`.
  const notConfigured = [wallet.error, earnings.error].some(
    (e) => e instanceof Error && /not configured|non-2xx|FunctionsHttpError/i.test(e.message),
  );

  const w = wallet.data;
  const balances = w?.balances ?? [];
  const withdrawable = w?.withdrawable ?? [];
  const trips = earnings.data?.trips ?? [];
  const destinations = earnings.data?.destinations ?? [];
  const canWithdraw = withdrawable.some((d) => d.availableAmount > 0);

  // Only destinations PayHold would actually accept. Offering one it will
  // refuse turns a clear "not verified yet" into a failed withdrawal.
  const usable = destinations.filter(
    (d) =>
      d.verifiedAt &&
      (!d.securityHoldUntil || new Date(d.securityHoldUntil) <= new Date()),
  );

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
            Every trip's money, where it is, and when it reaches you.
          </p>
        </div>
      </div>

      {(wallet.isLoading || earnings.isLoading) && !notConfigured && (
        <Card className="mt-6">
          <CardBody className="flex justify-center py-10">
            <Spinner size={22} />
          </CardBody>
        </Card>
      )}

      {/* PayHold isn't connected on this deployment. Not the host's problem and
          not a failure they can act on, so it reads as a status rather than an
          error — the red card below is for things that actually went wrong. */}
      {notConfigured && (
        <Card className="mt-6">
          <CardBody className="space-y-2 py-8 text-center">
            <Wallet size={22} className="mx-auto text-ink-400" />
            <p className="font-medium text-ink-900">Earnings aren't switched on yet</p>
            <p className="mx-auto max-w-md text-sm text-ink-600">
              Payments are still running on the old system. Once AutoHire is connected to
              PayHold, this page shows every trip's money, what stage it's at, and when it
              reaches your account.
            </p>
          </CardBody>
        </Card>
      )}

      {wallet.error && !notConfigured && (
        <Card className="mt-6 border-red-200 bg-red-50/50">
          <CardBody className="text-sm text-red-700">
            Couldn't load your balance.{' '}
            {wallet.error instanceof Error ? wallet.error.message : ''}
          </CardBody>
        </Card>
      )}

      {/* No payout destination — the wallet is empty because nothing can reach
          it, so say that rather than showing a row of zeroes. */}
      {w && !w.sellerId && !notConfigured && (
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

      {/* What's stopping money moving, before the figures — a host with a
          blocked payout needs the reason more than the number. */}
      {w?.sellerId && !w.canReceivePayouts && (
        <Card className="mt-6 border-amber-200 bg-amber-50/60">
          <CardBody className="space-y-2">
            <p className="flex items-center gap-2 font-medium text-ink-900">
              <AlertTriangle size={16} className="text-amber-600" /> Payouts are on hold
            </p>
            {w.reasons.length > 0 && (
              <ul className="ml-1 list-inside list-disc text-sm text-ink-700">
                {w.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {w.routeReasons.length > 0 && (
              <>
                <p className="pt-1 text-sm font-medium text-ink-700">On our side:</p>
                <ul className="ml-1 list-inside list-disc text-sm text-ink-600">
                  {w.routeReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {/* --- Totals --------------------------------------------------------- */}
      {balances.map((b) => (
        <Card key={b.currency} className="mt-6">
          <CardHeader className="flex items-center justify-between">
            <h2 className="font-semibold text-ink-900">Your money</h2>
            <Badge tone="neutral">{b.currency}</Badge>
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Figure
              icon={Lock}
              label="On trips"
              value={money(b.held, b.currency)}
              hint="Held while cars are out"
              tone="ink"
            />
            <Figure
              icon={Clock}
              label="Clearing"
              value={money(b.pendingClearance, b.currency)}
              hint="Yours, in the safety window"
              tone="amber"
            />
            <Figure
              icon={CheckCircle2}
              label="Available"
              value={money(b.available, b.currency)}
              hint="Ready to send"
              tone="emerald"
            />
          </CardBody>
        </Card>
      ))}

      {/* --- Where it goes, and sending it now ------------------------------ */}
      {withdrawable.map((d) => (
        <Card key={`w-${d.currency}`} className="mt-4 border-emerald-200 bg-emerald-50/40">
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-ink-600">Ready to send to your account</p>
                <p className="text-2xl font-bold text-ink-900">
                  {money(d.availableAmount, d.currency)}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {d.availableCount} trip{d.availableCount === 1 ? '' : 's'}
                  {d.clearingAmount > 0 &&
                    ` · ${money(d.clearingAmount, d.currency)} still clearing`}
                  {d.requestedCount > 0 && ` · ${d.requestedCount} already on the way`}
                </p>
                {(d.heldCount > 0 || d.needsVerificationCount > 0 || d.blockedCount > 0) && (
                  <p className="mt-1 text-xs text-amber-700">
                    {[
                      d.heldCount > 0 && `${d.heldCount} on hold`,
                      d.needsVerificationCount > 0 &&
                        `${d.needsVerificationCount} needs verification`,
                      d.blockedCount > 0 && `${d.blockedCount} blocked`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
              <Button
                disabled={!canWithdraw || withdraw.isPending || !w?.canReceivePayouts}
                onClick={() => withdraw.mutate()}
              >
                <Send size={16} />
                {withdraw.isPending ? 'Sending…' : 'Send it now'}
              </Button>
            </div>

            {/* Which account. Shown only when there's a real choice — a single
                destination is information, not a decision. */}
            {usable.length > 1 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-700">Send to</p>
                <div className="flex flex-wrap gap-2">
                  {usable.map((dest) => (
                    <DestinationChip
                      key={dest.id}
                      destination={dest}
                      selected={
                        destinationId === dest.id || (!destinationId && dest.isPrimary)
                      }
                      onSelect={() => setDestinationId(dest.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {usable.length === 1 && (
              <p className="text-xs text-ink-500">
                Going to {usable[0].label ?? usable[0].maskedDestination}
              </p>
            )}
          </CardBody>
        </Card>
      ))}

      {/* Destinations PayHold would refuse. Listed so a host knows why the one
          they added yesterday isn't an option yet. */}
      {destinations.length > usable.length && (
        <Card className="mt-4 border-amber-200">
          <CardBody className="space-y-1.5">
            <p className="text-sm font-medium text-ink-900">Not usable yet</p>
            {destinations
              .filter((d) => !usable.includes(d))
              .map((d) => (
                <p key={d.id} className="text-xs text-ink-600">
                  {d.label ?? d.maskedDestination} —{' '}
                  {!d.verifiedAt
                    ? 'waiting to be verified'
                    : `on a security hold until ${formatDate(d.securityHoldUntil!)}`}
                </p>
              ))}
          </CardBody>
        </Card>
      )}

      {/* --- Trip by trip --------------------------------------------------- */}
      {trips.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 font-semibold text-ink-900">Trip by trip</h2>
          <div className="space-y-3">
            {trips.map((t) => (
              <TripRow key={t.bookingId} trip={t} />
            ))}
          </div>
          {earnings.data?.hasMore && (
            <p className="mt-4 text-center text-xs text-ink-500">
              Showing your {trips.length} most recent trips.
            </p>
          )}
        </>
      )}

      {w?.sellerId && trips.length === 0 && !earnings.isLoading && (
        <Card className="mt-6">
          <CardBody className="py-10 text-center">
            <p className="font-medium text-ink-900">No earnings yet</p>
            <p className="mt-1 text-sm text-ink-500">
              Money from your first completed trip will show up here.
            </p>
          </CardBody>
        </Card>
      )}

      <p className={cn('mt-6 text-xs text-ink-500', notConfigured && 'hidden')}>
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

/** One trip: what it earned, where that money is, and when it lands. */
function TripRow({ trip }: { trip: EarningTrip }) {
  const [open, setOpen] = useState(false);
  const stage = STAGES[trip.stage];
  const Icon = stage.icon;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">{trip.car}</p>
            <p className="text-xs text-ink-500">
              {formatDate(trip.startDate)} – {formatDate(trip.endDate)} · {trip.days} day
              {trip.days === 1 ? '' : 's'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {trip.net !== null && (
              <p className="font-bold text-ink-900">{money(trip.net, trip.currency)}</p>
            )}
            <span
              className={cn(
                'mt-0.5 inline-flex items-center gap-1 text-xs font-medium',
                stage.tone === 'emerald' && 'text-emerald-700',
                stage.tone === 'amber' && 'text-amber-700',
                stage.tone === 'red' && 'text-red-700',
                stage.tone === 'ink' && 'text-ink-500',
              )}
            >
              <Icon size={13} /> {stage.label}
            </span>
          </div>
        </div>

        <p className="text-xs text-ink-600">
          {stage.hint}
          {/* The date is the part a host is really after — "clearing" without
              "until when" is the same as not knowing. */}
          {trip.stage === 'clearing' && trip.availableAt && (
            <> Available {formatDate(trip.availableAt)}.</>
          )}
          {trip.stage === 'paid' && trip.paidAt && <> Sent {formatDate(trip.paidAt)}.</>}
        </p>

        {trip.stage === 'on_hold' && trip.holdReason && (
          <p className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs text-red-700">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            {trip.holdReason}
          </p>
        )}

        {/* The gap between what the renter paid and what the host gets is the
            single most-queried number on this page. One tap, always available. */}
        {trip.gross !== null && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {open ? 'Hide breakdown' : 'How this was worked out'}
            </button>
            {open && (
              <dl className="space-y-1 rounded-lg bg-ink-50 p-3 text-xs">
                <Line label="Renter paid" value={money(trip.gross, trip.currency)} />
                {trip.platformFee !== null && trip.platformFee > 0 && (
                  <Line
                    label="AutoHire fee"
                    value={`− ${money(trip.platformFee, trip.currency)}`}
                  />
                )}
                {trip.providerFee !== null && trip.providerFee > 0 && (
                  <Line
                    label="Payment fee"
                    value={`− ${money(trip.providerFee, trip.currency)}`}
                  />
                )}
                {trip.refunded !== null && trip.refunded > 0 && (
                  <Line label="Refunded" value={`− ${money(trip.refunded, trip.currency)}`} />
                )}
                {trip.net !== null && (
                  <div className="flex justify-between border-t border-ink-200 pt-1 font-semibold text-ink-900">
                    <dt>You earn</dt>
                    <dd>{money(trip.net, trip.currency)}</dd>
                  </div>
                )}
              </dl>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-600">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DestinationChip({
  destination,
  selected,
  onSelect,
}: {
  destination: PayoutDestination;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border px-3 py-2 text-left text-xs transition-all',
        selected
          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
          : 'border-ink-200 bg-white hover:border-ink-300',
      )}
    >
      <span className="block font-medium text-ink-900">
        {destination.label ?? destination.maskedDestination}
      </span>
      <span className="block text-ink-500">
        {destination.maskedDestination}
        {destination.isPrimary && ' · default'}
      </span>
    </button>
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
  tone: 'ink' | 'amber' | 'emerald';
}) {
  return (
    <div>
      <p
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          tone === 'emerald' && 'text-emerald-700',
          tone === 'amber' && 'text-amber-700',
          tone === 'ink' && 'text-ink-500',
        )}
      >
        <Icon size={14} /> {label}
      </p>
      <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
    </div>
  );
}
