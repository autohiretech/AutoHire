import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  Coins,
  Hourglass,
  ListOrdered,
  Lock,
  Send,
  ShieldAlert,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { EarningStage, EarningTrip, PayholdBalance } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatMoney, formatMoneyMinor } from '@/lib/currency';
import { formatDate } from '@/lib/format';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Badge, Button, Card, CardBody, CardHeader, Spinner, toast } from '@/components/ui';

const money = formatMoneyMinor;

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

  // Balance and history are two different questions a host asks at two
  // different moments — "how much, and can I send it" versus "which trip made
  // this" — and stacking both under one scroll made the figure they actually
  // came for compete for space with a list they were not reading yet.
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  // Which of the host's currencies is on screen. Null means "whatever's
  // first" — most hosts only ever earn in one, so this never has to be
  // touched; it only becomes a real choice once `shownBalances` has more than
  // one entry, same "don't offer a pick nobody needs" rule as the payout
  // destination above.
  const [activeCurrency, setActiveCurrency] = useState<string | null>(null);

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
    // No destination to choose — a host only ever sees the one PayHold pays
    // to, so a withdrawal always goes there. PayHold's own default (the
    // primary) is exactly that account.
    mutationFn: () => client.payholdWithdraw(),
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

  // A host is shown one destination — the one PayHold actually pays.
  // `destinations` can carry more (PayHold keeps a demoted one on file rather
  // than deleting it, so money already sent there stays explained), but a
  // second row nobody chose to see is confusing, not informative. `isPrimary`
  // is PayHold's own answer to "which one is live"; falling back to the
  // first row only covers a seller synced from before that flag existed.
  const primary = destinations.find((d) => d.isPrimary) ?? destinations[0] ?? null;
  const primaryReady =
    !!primary?.verifiedAt &&
    (!primary.securityHoldUntil || new Date(primary.securityHoldUntil) <= new Date());

  /**
   * The totals always render, at zero if that is the truth.
   *
   * PayHold returns no balance rows at all for a seller who has not been paid
   * yet — there is no ledger entry to sum — so `balances.map` drew nothing and a
   * new host saw a page of warnings with no figures on it. That reads as broken
   * rather than as empty. A zero in "Available" is a real answer to "how much do
   * I have", and it also shows the host what this page will look like once money
   * starts moving.
   *
   * The currency comes from where they'd actually be paid, not from a guess: the
   * withdrawable row first, then their payout destination. With neither there is
   * nothing truthful to label a zero with, so the card stays hidden.
   */
  const fallbackCurrency = withdrawable[0]?.currency ?? destinations[0]?.payoutCurrency ?? null;
  const shownBalances =
    balances.length > 0
      ? balances
      : fallbackCurrency
        ? [
            {
              currency: fallbackCurrency,
              held: 0,
              pendingClearance: 0,
              available: 0,
              reserved: 0,
              paidOut: 0,
            },
          ]
        : [];

  // The currency actually on screen. Falls back to the first balance rather
  // than staying null so a stale `activeCurrency` (a currency that stopped
  // having a row, e.g. once it clears to zero and drops out) doesn't leave
  // every currency-scoped card blank.
  const currency = shownBalances.some((b) => b.currency === activeCurrency)
    ? activeCurrency!
    : (shownBalances[0]?.currency ?? null);
  const balanceForCurrency = shownBalances.find((b) => b.currency === currency) ?? null;
  const withdrawableForCurrency = withdrawable.find((d) => d.currency === currency) ?? null;

  return (
    <section className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Hero — the same gradient band the host dashboard opens with, so this
          reads as part of one product rather than a plain settings page
          bolted onto it. The available figure lives here, not three sections
          down: it's the one number a host opened this page to see. */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 via-white to-ink-50 px-5 py-6 shadow-card sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-brand-200/30 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <Wallet size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">Earnings</h1>
              <p className="mt-0.5 text-sm text-ink-500">Every trip's money, and when it reaches you.</p>
            </div>
          </div>

          {balanceForCurrency && (
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
                Available to send
              </p>
              <p className="mt-0.5 text-3xl font-bold tabular-nums leading-tight text-ink-900">
                {money(balanceForCurrency.available, balanceForCurrency.currency)}
              </p>
            </div>
          )}
        </div>

        {/* Currency pills — only once there's more than one to choose
            between. Sits inside the hero, beside the figure it controls,
            rather than as a separate row a host has to connect to it. The
            payout currency gets a dot: everything else on this row is money
            still priced in whatever it was charged in, and converts into
            that one the moment it releases (see the note on "Your money"). */}
        {shownBalances.length > 1 && (
          <div className="relative mt-4 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-4">
            <Coins size={13} className="mr-0.5 text-ink-400" />
            {shownBalances.map((b) => {
              const isPayoutCurrency = b.currency === primary?.payoutCurrency;
              return (
                <button
                  key={b.currency}
                  type="button"
                  onClick={() => setActiveCurrency(b.currency)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                    currency === b.currency
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50',
                  )}
                >
                  {isPayoutCurrency && (
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        currency === b.currency ? 'bg-white' : 'bg-emerald-500',
                      )}
                    />
                  )}
                  {b.currency}
                </button>
              );
            })}
            {primary && (
              <span className="ml-1 text-[11px] text-ink-400">
                · paid in {primary.payoutCurrency}
              </span>
            )}
          </div>
        )}
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

      {/* --- Overview / Trip by trip -----------------------------------------
          Two different questions asked at two different moments: "how much,
          and can I send it" versus "which trip made this". Stacking both under
          one scroll made the figure a host actually opened this page for
          compete with a list they weren't reading yet. */}
      {w?.sellerId && !notConfigured && !earnings.isLoading && (
        <div className="mt-6 inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
              tab === 'overview' ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-50',
            )}
          >
            <Wallet size={14} /> Overview
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
              tab === 'history' ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-50',
            )}
          >
            <ListOrdered size={14} /> Trip by trip
            {trips.length > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  tab === 'history' ? 'bg-white/20' : 'bg-ink-100 text-ink-500',
                )}
              >
                {trips.length}
              </span>
            )}
          </button>
        </div>
      )}

      {tab === 'overview' && w?.sellerId && !notConfigured && !earnings.isLoading && (
        <>
          {/* --- Where you get paid -------------------------------------------
              Always on the page once a seller exists, not folded into the
              withdraw card. That card only renders when PayHold returns a
              withdrawable row, so a host with nothing cleared yet — every new
              host — previously had no way to see or reach their payout method
              from here at all. */}
          <Card className="mt-4">
            <CardHeader className="flex items-center justify-between">
              <h2 className="font-semibold text-ink-900">Where you get paid</h2>
              {/* Offered whether or not a destination exists.

                  This used to be hidden for anyone who already had one, on the
                  reasoning that changing it was "not built on either side" and
                  a button here would open a screen that refuses with
                  `seller_exists`. That stopped being true when
                  `payhold-register-seller` grew its change path: it branches
                  on `payhold_seller_id` and calls `POST /sellers/:id/destinations`,
                  which adds the row, makes it primary and demotes the old one
                  atomically. So the only thing standing between a host and
                  their own bank details was this condition. */}
              <Button variant="outline" size="sm" onClick={() => navigate('/payouts/setup')}>
                <Banknote size={14} />
                {primary ? 'Change' : 'Add a method'}
              </Button>
            </CardHeader>
            <CardBody className="space-y-2">
              {!primary && (
                <p className="text-sm text-ink-600">
                  {me?.payoutLabel
                    ? `${me.payoutLabel} — PayHold is still setting this up, so it can't receive money yet.`
                    : "You don't have a payout method yet. Money from your trips will wait here until you add one."}
                </p>
              )}
              {primary && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Banknote size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink-900">
                        {primary.label ?? primary.maskedDestination}
                      </p>
                      <p className="text-xs text-ink-500">
                        {primary.maskedDestination} · {primary.payoutCurrency}
                      </p>
                    </div>
                  </div>
                  <Badge tone={primaryReady ? 'success' : 'neutral'}>
                    {primaryReady
                      ? 'Ready'
                      : !primary.verifiedAt
                        ? 'Being verified'
                        : `On hold until ${formatDate(primary.securityHoldUntil!)}`}
                  </Badge>
                </div>
              )}
            </CardBody>
          </Card>

          {/* --- Balance, for the selected currency only -----------------------
              A bar rather than three numbers side by side: proportion is the
              thing a host actually wants at a glance — how much of what they
              earned is still tied up versus ready — and three same-sized
              figures say that only if you do the arithmetic yourself. */}
          {balanceForCurrency && (
            <Card className="mt-4">
              <CardHeader className="flex items-center justify-between">
                <h2 className="font-semibold text-ink-900">Your money</h2>
                <Badge tone="neutral">{balanceForCurrency.currency}</Badge>
              </CardHeader>
              <CardBody>
                <BalanceBar balance={balanceForCurrency} />
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <MoneyStat
                    icon={Lock}
                    tone="muted"
                    label="On trips"
                    value={money(balanceForCurrency.held, balanceForCurrency.currency)}
                  />
                  <MoneyStat
                    icon={Clock}
                    tone="amber"
                    label="Clearing"
                    value={money(balanceForCurrency.pendingClearance, balanceForCurrency.currency)}
                  />
                  <MoneyStat
                    icon={CheckCircle2}
                    tone="green"
                    label="Available"
                    value={money(balanceForCurrency.available, balanceForCurrency.currency)}
                  />
                </div>
                {/* PayHold converts every trip into the payout destination's
                    own currency the moment it releases (`releaseFigures` —
                    convertOrThrow against `sellers.payout_currency`), so a
                    balance shown in a different currency isn't a second
                    wallet to manage — it's just what this trip happened to be
                    charged in before that conversion runs. Only shown when
                    it's actually true of this card, so a host who only ever
                    sees their own payout currency never sees a sentence about
                    conversion that doesn't apply to them. */}
                {primary && balanceForCurrency.currency !== primary.payoutCurrency && (
                  <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
                    <Coins size={13} className="mt-0.5 shrink-0 text-ink-400" />
                    Converts to {primary.payoutCurrency} — what {primary.label ?? 'your payout method'}{' '}
                    actually pays in — the moment each trip releases.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {/* --- Where it goes, and sending it now -----------------------------
              A brand-tinted CTA rather than the muted card the rest of the
              page uses — this is the one action on Overview, and it should
              look like one rather than blend in with the read-only cards
              above it. */}
          {withdrawableForCurrency && (
            <div className="relative mt-4 overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-600 to-brand-700 p-5 text-white shadow-card sm:p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
              />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-brand-100">Ready to send to your account</p>
                  <p className="mt-0.5 text-3xl font-bold tabular-nums leading-tight">
                    {money(withdrawableForCurrency.availableAmount, withdrawableForCurrency.currency)}
                  </p>
                  <p className="mt-1.5 text-xs text-brand-100">
                    {withdrawableForCurrency.availableCount} trip
                    {withdrawableForCurrency.availableCount === 1 ? '' : 's'}
                    {withdrawableForCurrency.clearingAmount > 0 &&
                      ` · ${money(withdrawableForCurrency.clearingAmount, withdrawableForCurrency.currency)} still clearing`}
                    {withdrawableForCurrency.requestedCount > 0 &&
                      ` · ${withdrawableForCurrency.requestedCount} already on the way`}
                  </p>
                  {(withdrawableForCurrency.heldCount > 0 ||
                    withdrawableForCurrency.needsVerificationCount > 0 ||
                    withdrawableForCurrency.blockedCount > 0) && (
                    <p className="mt-1 text-xs text-accent-400">
                      {[
                        withdrawableForCurrency.heldCount > 0 &&
                          `${withdrawableForCurrency.heldCount} on hold`,
                        withdrawableForCurrency.needsVerificationCount > 0 &&
                          `${withdrawableForCurrency.needsVerificationCount} needs verification`,
                        withdrawableForCurrency.blockedCount > 0 &&
                          `${withdrawableForCurrency.blockedCount} blocked`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  {/* One destination, so nothing to pick — just say where it's
                      going, because "send it now" should never be the first
                      time a host finds out. */}
                  {primary && (
                    <p className="mt-2 text-xs text-brand-100">
                      {primaryReady
                        ? `Going to ${primary.label ?? primary.maskedDestination}`
                        : `${primary.label ?? primary.maskedDestination} isn't usable yet — ${
                            !primary.verifiedAt
                              ? 'still being verified'
                              : `on hold until ${formatDate(primary.securityHoldUntil!)}`
                          }.`}
                    </p>
                  )}
                </div>
                {/* "Send it now" doubles as a retry: `request_withdrawal` claims
                    payouts in `scheduled`, `blocked`, `needs_verification`,
                    `failed` or `frozen`, not only ones already sitting at a
                    sendable amount. Gating the button on `availableAmount > 0`
                    alone made a host with everything stuck at `blocked` unable
                    to even attempt the one action that might unstick it — a
                    live retry against production confirmed the call goes
                    through and reaches the real payout rail even when
                    `availableAmount` reads zero. `heldCount` stays out of the
                    condition on purpose: a `held_for_review` payout waits on a
                    named person clearing it (invariant 11), and a retry from
                    here cannot do that regardless of button state. */}
                {(() => {
                  const hasAvailable = withdrawableForCurrency.availableAmount > 0;
                  const hasRetriable =
                    withdrawableForCurrency.blockedCount > 0 ||
                    withdrawableForCurrency.needsVerificationCount > 0;
                  return (
                    <Button
                      className="bg-white text-brand-700 shadow-sm hover:bg-brand-50"
                      disabled={
                        (!hasAvailable && !hasRetriable) || withdraw.isPending || !w?.canReceivePayouts
                      }
                      onClick={() => withdraw.mutate()}
                    >
                      <Send size={16} />
                      {withdraw.isPending
                        ? 'Sending…'
                        : hasAvailable
                          ? 'Send it now'
                          : hasRetriable
                            ? 'Retry stuck payouts'
                            : 'Send it now'}
                    </Button>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {/* --- Trip by trip -------------------------------------------------------
          No empty state beyond this one line — a host with no completed trips
          already sees the totals on Overview reading zero, and a second card
          repeating that here would read like a fault rather than an empty
          state. */}
      {tab === 'history' && (
        <div className="mt-4">
          {trips.length > 0 ? (
            <>
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
          ) : (
            <Card>
              <CardBody className="py-10 text-center text-sm text-ink-500">
                No trips yet — this fills in as your cars get booked.
              </CardBody>
            </Card>
          )}
        </div>
      )}

      <p className={cn('mt-6 text-xs text-ink-500', notConfigured && 'hidden')}>
        Money is held while a trip runs and released when you and the renter both confirm the car
        came back. It then clears before it can be sent, and moves to your account on its own
        schedule from there —{' '}
        <span className="font-medium text-ink-600">use "Send it now" to speed that up</span>, or
        to retry a payout that didn't go through.
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

        {/* AutoHire's own figure, not PayHold's — an hourly trip that ran over
            its deposit, or a daily one returned more than 2 hours late.
            Never charged automatically; this is the reminder to follow up. */}
        {trip.amountOwedRwf > 0 && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            {formatMoney(trip.amountOwedRwf, trip.currency)} still to pay
            {trip.rentalType === 'hourly' ? ' for time beyond the deposit' : ' for a late return'}
            {!!trip.amountExceededRwf &&
              trip.amountExceededRwf > trip.amountOwedRwf &&
              ` (exceeded by ${formatMoney(trip.amountExceededRwf, trip.currency)} — you've already reduced this)`}
            . Open the trip to mark it collected or reduce it further.
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

/**
 * Proportion at a glance — held, clearing and available as one segmented bar
 * rather than three same-sized numbers a host has to compare themselves.
 * Negative segments (the ledger can carry a transient negative `pendingClearance`
 * mid-transition) are clamped to zero for the bar; the exact signed figure
 * still renders in the `MoneyStat` chip underneath it.
 */
function BalanceBar({ balance }: { balance: PayholdBalance }) {
  const held = Math.max(0, balance.held);
  const clearing = Math.max(0, balance.pendingClearance);
  const available = Math.max(0, balance.available);
  const total = held + clearing + available;

  if (total <= 0) {
    return <div className="h-2 w-full rounded-full bg-ink-100" />;
  }

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-100">
      {held > 0 && <div className="h-full bg-ink-300" style={{ width: `${(held / total) * 100}%` }} />}
      {clearing > 0 && (
        <div className="h-full bg-amber-400" style={{ width: `${(clearing / total) * 100}%` }} />
      )}
      {available > 0 && (
        <div className="h-full bg-emerald-500" style={{ width: `${(available / total) * 100}%` }} />
      )}
    </div>
  );
}

const MONEY_STAT_CHIP: Record<'muted' | 'amber' | 'green', string> = {
  muted: 'bg-ink-100 text-ink-500',
  amber: 'bg-amber-50 text-amber-600',
  green: 'bg-emerald-50 text-emerald-600',
};

/** One balance figure as a tinted icon chip — the same shape the host
 * dashboard's stat cards use, so this page reads as the same product. */
function MoneyStat({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Lock;
  tone: 'muted' | 'amber' | 'green';
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', MONEY_STAT_CHIP[tone])}>
        <Icon size={15} />
      </span>
      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold tabular-nums leading-tight text-ink-900">
        {value}
      </p>
    </div>
  );
}
