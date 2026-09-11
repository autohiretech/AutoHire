import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, FileText, Handshake, History, RefreshCw, Scale } from 'lucide-react';
import type { AdminDisputeDetail, Dispute, DisputeResolution } from '@autohire/shared';
import { client } from '@/lib/client';
import { formatDate, timeAgo } from '@/lib/format';
import { formatMoney, formatMoneyMinor, isCurrencyCode } from '@/lib/currency';
import { DISPUTE_STATUS_META } from '@/lib/admin';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, CardBody, CardHeader, Chip, ConfirmDialog, Input, Label, Skeleton, toast } from '@/components/ui';

type Filter = 'needs' | 'resolved' | 'all';

/** Still waiting on an admin — including a decision saved but not yet carried out. */
function needsDecision(d: Dispute): boolean {
  return d.status === 'open' || d.status === 'under_review';
}

/** PayHold speaks of buyer and seller; on AutoHire they are the renter and the host. */
const SIDE: Record<string, string> = { buyer: 'Renter', seller: 'Host' };
const side = (s: string) => SIDE[s] ?? s;

/** `not_as_described` → "Not as described", `dispute.offer_made` → "Dispute offer made". */
function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const t = code.replace(/[._]/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '—';
  if (currency && isCurrencyCode(currency)) return formatMoney(amount, currency);
  return `${amount.toLocaleString()}${currency ? ` ${currency}` : ''}`;
}

/**
 * The amount claimed, in the currency it is actually in. `amount_rwf` holds
 * the booking's own currency despite its name (the car's `price_currency`), so
 * printing it as RWF was wrong for every non-Rwandan car. A PayHold-backed
 * dispute knows the exact disputed amount in minor units of its deal currency;
 * otherwise the stored amount is shown in that currency when known.
 */
function claimAmount(d: Dispute): string {
  if (d.disputedAmountMinor != null && d.currency) return formatMoneyMinor(d.disputedAmountMinor, d.currency);
  return money(d.amountRwf, d.currency ?? 'RWF');
}

const NOT_TRUSTED_COPY =
  "Your decision is saved in AutoHire, but PayHold hasn't been told to accept AutoHire's dispute decisions yet, so no money has moved. In PayHold, open Settings and turn on “My platform decides disputes and tells PayHold the outcome”, then press Send to PayHold again.";

/**
 * Admin → Disputes. The admin decides here; PayHold, which holds the money,
 * carries the decision out. A dispute with no PayHold payment behind it (older
 * bookings, or ones that never reached checkout) can only have its outcome
 * recorded — there is nothing to move.
 */
export function DisputesSection({ nameOf }: { nameOf: (id: string) => string }) {
  const [filter, setFilter] = useState<Filter>('needs');
  const query = useQuery({ queryKey: ['disputes'], queryFn: () => client.listDisputes() });
  const all = query.data ?? [];
  const waiting = all.filter(needsDecision);
  const done = all.filter((d) => !needsDecision(d));
  const shown = filter === 'needs' ? waiting : filter === 'resolved' ? done : all;

  if (query.isLoading) return <ListSkeleton />;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Chip selected={filter === 'needs'} onClick={() => setFilter('needs')}>
          Needs a decision <Count n={waiting.length} />
        </Chip>
        <Chip selected={filter === 'resolved'} onClick={() => setFilter('resolved')}>
          Decided <Count n={done.length} />
        </Chip>
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
          All <Count n={all.length} />
        </Chip>
      </div>

      <div className="mt-4 space-y-3">
        {shown.length === 0 ? (
          <Card>
            <CardBody className="py-12 text-center text-body-sm text-[var(--color-content-muted)]">
              {filter === 'needs' ? 'Nothing waiting on a decision.' : 'No disputes here.'}
            </CardBody>
          </Card>
        ) : (
          shown.map((d) => <DisputeRow key={d.id} dispute={d} nameOf={nameOf} />)
        )}
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tabular text-[var(--color-content-subtle)]">{n}</span>;
}

function DisputeRow({ dispute: d, nameOf }: { dispute: Dispute; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const meta = DISPUTE_STATUS_META[d.status];
  const pendingRelay = d.status === 'under_review' && !!d.resolution;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
          <Scale size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[var(--color-content)]">
            {nameOf(d.raisedBy)} vs {nameOf(d.against)}
          </span>
          <span className="tabular block truncate text-caption text-[var(--color-content-subtle)]">
            {claimAmount(d)} claim · opened {timeAgo(d.createdAt)} · booking {d.bookingId}
          </span>
        </span>
        {!d.payholdDisputeId && <Badge tone="neutral">No PayHold payment</Badge>}
        <Badge tone={meta.tone}>{pendingRelay ? 'Decided — not sent' : meta.label}</Badge>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="border-t border-[var(--color-line)]">
          <DisputeDetail dispute={d} nameOf={nameOf} />
        </div>
      )}
    </Card>
  );
}

function DisputeDetail({ dispute: d, nameOf }: { dispute: Dispute; nameOf: (id: string) => string }) {
  const detail = useQuery({ queryKey: ['adminDispute', d.id], queryFn: () => client.getAdminDispute(d.id) });

  if (detail.isLoading) {
    return (
      <CardBody className="space-y-3" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </CardBody>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <CardBody className="flex items-center justify-between gap-3 text-body-sm text-[var(--color-content-muted)]">
        Couldn&apos;t load this dispute from PayHold.
        <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
          <RefreshCw size={14} /> Try again
        </Button>
      </CardBody>
    );
  }

  const { dispute, payhold } = detail.data;
  return (
    <CardBody className="space-y-6">
      <section>
        <SubTitle>The claim</SubTitle>
        <p className="text-body-sm text-[var(--color-content)]">{dispute.reason}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-4">
          <Fact label="Raised by" value={nameOf(dispute.raisedBy)} />
          <Fact label="Against" value={nameOf(dispute.against)} />
          <Fact label="Reason" value={humanize(dispute.reasonCode ?? payhold?.reasonCode)} />
          <Fact label="Opened" value={formatDate(dispute.createdAt)} />
        </dl>
      </section>

      {payhold && (
        <section>
          <SubTitle>Money held by PayHold</SubTitle>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-4">
            <Fact label="Payment" value={money(payhold.dealAmount, payhold.currency)} />
            <Fact
              label="In dispute"
              value={payhold.disputedAmount == null ? 'Whole payment' : money(payhold.disputedAmount, payhold.currency)}
            />
            <Fact label="PayHold status" value={humanize(payhold.status)} />
          </dl>
        </section>
      )}

      {payhold && payhold.offers.length > 0 && (
        <section>
          <SubTitle icon={<Handshake size={14} />}>Offers between the two sides</SubTitle>
          <ul className="space-y-2 text-body-sm">
            {payhold.offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--color-content)]">{humanize(o.kind)}</span>
                {o.amount != null && <span className="tabular">{money(o.amount, payhold.currency)}</span>}
                <Badge tone="neutral">{humanize(o.status)}</Badge>
                <span className="text-caption text-[var(--color-content-subtle)]">
                  from the {side(o.offeredBy).toLowerCase()} · {timeAgo(o.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {payhold && payhold.evidence.length > 0 && (
        <section>
          <SubTitle icon={<FileText size={14} />}>Evidence</SubTitle>
          <ul className="space-y-2 text-body-sm">
            {payhold.evidence.map((e) => (
              <li key={e.id}>
                <p className="text-[var(--color-content)]">{e.description}</p>
                <p className="text-caption text-[var(--color-content-subtle)]">
                  {humanize(e.kind)} · {side(e.uploadedBy)} · {timeAgo(e.createdAt)}
                  {e.reference &&
                    (/^https?:\/\//.test(e.reference) ? (
                      <>
                        {' '}
                        ·{' '}
                        <a href={e.reference} target="_blank" rel="noreferrer" className="underline">
                          open
                        </a>
                      </>
                    ) : (
                      ` · ${e.reference}`
                    ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-[var(--color-line)] pt-5">
        <DecisionArea detail={detail.data} />
      </section>

      {payhold && payhold.timeline.length > 0 && (
        <section>
          <SubTitle icon={<History size={14} />}>Timeline</SubTitle>
          <ol className="space-y-1.5 text-caption text-[var(--color-content-muted)]">
            {[...payhold.timeline].reverse().map((t, i) => (
              <li key={i} className="tabular">
                <span className="text-[var(--color-content-subtle)]">{formatDate(t.at)}</span> ·{' '}
                {humanize(t.event)}
                {t.actor ? ` · ${side(t.actor)}` : ''}
                {t.detail ? ` — ${t.detail}` : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
    </CardBody>
  );
}

function DecisionArea({ detail }: { detail: AdminDisputeDetail }) {
  const { dispute: d, payhold } = detail;

  if (!needsDecision(d)) return <Outcome dispute={d} decidedByName={detail.decidedByName} />;
  if (!payhold) return <LocalDecision dispute={d} />;
  if (d.resolution) return <PendingRelay dispute={d} />;
  return <DecisionForm detail={detail} />;
}

/** A decision that has been saved but not carried out — no past tense, nothing has moved. */
const RESOLUTION_PLAN: Record<DisputeResolution, string> = {
  release: 'Release to host',
  refund: 'Refund renter',
  partial_refund: 'Partial refund',
};

const RESOLUTION_LABEL: Record<DisputeResolution, string> = {
  release: 'Released to host',
  refund: 'Refunded to renter',
  partial_refund: 'Partly refunded',
};

function Outcome({ dispute: d, decidedByName }: { dispute: Dispute; decidedByName: string | null }) {
  return (
    <div>
      <SubTitle>Outcome</SubTitle>
      <p className="text-body-sm text-[var(--color-content)]">
        {d.resolution ? RESOLUTION_LABEL[d.resolution] : DISPUTE_STATUS_META[d.status].label}
      </p>
      {d.resolutionNote && <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">“{d.resolutionNote}”</p>}
      {(d.decidedBy || d.resolvedAt) && (
        <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
          {d.decidedBy
            ? `Decided by ${decidedByName ?? (d.decidedBy.startsWith('autohire-admin:') ? 'an AutoHire admin' : 'PayHold staff')}`
            : ''}
          {d.resolvedAt ? ` · ${formatDate(d.resolvedAt)}` : ''}
        </p>
      )}
    </div>
  );
}

/** A decision is saved but PayHold hasn't carried it out — usually the relay setting is off. */
function PendingRelay({ dispute: d }: { dispute: Dispute }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => client.resolvePayholdDispute({ disputeId: d.id, retry: true }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
      void queryClient.invalidateQueries({ queryKey: ['adminDispute', d.id] });
      if (r.outcome === 'resolved') toast.success('Sent. PayHold is moving the money now.');
      else toast.info(NOT_TRUSTED_COPY);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-3">
      <SubTitle>Decision saved — not carried out yet</SubTitle>
      <p className="text-body-sm text-[var(--color-content)]">{RESOLUTION_PLAN[d.resolution!]} — waiting</p>
      {d.resolutionNote && (
        <p className="text-body-sm text-[var(--color-content-muted)]">“{d.resolutionNote}”</p>
      )}
      <p className="text-caption text-[var(--color-content-muted)]">
        No money has moved. The usual reason is that PayHold isn&apos;t set to accept AutoHire&apos;s dispute
        decisions yet: in PayHold, open Settings and turn on “My platform decides disputes and tells PayHold the
        outcome”. If it&apos;s already on, PayHold may have been unreachable — sending again is safe and sends this
        same decision.
      </p>
      <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
        <RefreshCw size={14} /> {retry.isPending ? 'Sending…' : 'Send to PayHold again'}
      </Button>
    </div>
  );
}

/** No PayHold payment behind this dispute: only the outcome is recorded. */
function LocalDecision({ dispute: d }: { dispute: Dispute }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: Dispute['status']) => client.resolveDispute(d.id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
      void queryClient.invalidateQueries({ queryKey: ['adminDispute', d.id] });
    },
  });
  return (
    <div className="space-y-3">
      <SubTitle>Record the outcome</SubTitle>
      <p className="text-caption text-[var(--color-content-muted)]">
        This booking has no payment held in PayHold, so there is no money to move — this only records who was right.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => mutation.mutate('resolved_renter')} disabled={mutation.isPending}>
          Renter was right
        </Button>
        <Button size="sm" variant="outline" onClick={() => mutation.mutate('resolved_host')} disabled={mutation.isPending}>
          Host was right
        </Button>
        <Button size="sm" variant="ghost" onClick={() => mutation.mutate('dismissed')} disabled={mutation.isPending}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function DecisionForm({ detail }: { detail: AdminDisputeDetail }) {
  const { dispute: d } = detail;
  const payhold = detail.payhold!;
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState<DisputeResolution | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const partOnly = payhold.disputedAmount != null && payhold.disputedAmount < payhold.dealAmount;
  const refundCap = payhold.disputedAmount ?? payhold.dealAmount;
  const amountNum = Number(amount);
  const amountValid =
    resolution !== 'partial_refund' ||
    (amount.trim() !== '' && Number.isFinite(amountNum) && amountNum > 0 && amountNum < payhold.dealAmount && amountNum <= refundCap);
  const valid = !!resolution && note.trim().length > 0 && amountValid;

  const mutation = useMutation({
    mutationFn: () =>
      client.resolvePayholdDispute({
        disputeId: d.id,
        resolution: resolution!,
        refundAmount: resolution === 'partial_refund' ? amountNum : undefined,
        note: note.trim(),
      }),
    onSuccess: (r) => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
      void queryClient.invalidateQueries({ queryKey: ['adminDispute', d.id] });
      if (r.outcome === 'resolved') toast.success('Decided. PayHold is moving the money now.');
      else toast.info(NOT_TRUSTED_COPY);
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(e instanceof Error ? e.message : String(e));
    },
  });

  const summary =
    resolution === 'release'
      ? `Pay the host the full ${money(payhold.dealAmount, payhold.currency)}. Nothing goes back to the renter.`
      : resolution === 'refund'
        ? `Refund the full ${money(payhold.dealAmount, payhold.currency)} to the renter. The host is paid nothing.`
        : resolution === 'partial_refund' && amountValid
          ? `Refund ${money(amountNum, payhold.currency)} to the renter and pay the host the remaining ${money(payhold.dealAmount - amountNum, payhold.currency)}.`
          : '';

  const options: { key: DisputeResolution; title: string; body: string; disabled?: boolean }[] = [
    { key: 'release', title: 'Release to host', body: 'The host is paid in full.' },
    {
      key: 'refund',
      title: 'Refund renter',
      body: partOnly ? 'Only part of this payment is disputed — use a partial refund.' : 'The renter gets everything back.',
      disabled: partOnly,
    },
    { key: 'partial_refund', title: 'Partial refund', body: 'Split it: part back to the renter, the rest to the host.' },
  ];

  return (
    <div className="space-y-4">
      <SubTitle>Your decision</SubTitle>
      <div role="radiogroup" aria-label="Decision" className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={resolution === o.key}
            disabled={o.disabled}
            onClick={() => setResolution(o.key)}
            className={cn(
              'rounded-[var(--radius-control)] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              resolution === o.key
                ? 'border-[var(--color-accent-on)] bg-[var(--color-surface-sunken)]'
                : 'border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]',
            )}
          >
            <span className="block text-body-sm font-semibold text-[var(--color-content)]">{o.title}</span>
            <span className="mt-0.5 block text-caption text-[var(--color-content-muted)]">{o.body}</span>
          </button>
        ))}
      </div>

      {resolution === 'partial_refund' && (
        <div className="max-w-xs">
          <Label htmlFor={`refund-${d.id}`}>Refund to the renter ({payhold.currency})</Label>
          <Input
            id={`refund-${d.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== '' && !amountValid}
          />
          <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
            More than 0 and at most {money(refundCap, payhold.currency)}
            {refundCap === payhold.dealAmount ? ', less than the whole payment' : ''}.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor={`note-${d.id}`}>Why (kept in the audit trail on both sides)</Label>
        <textarea
          id={`note-${d.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]"
          placeholder="What you checked and why this outcome is fair."
        />
      </div>

      <Button onClick={() => setConfirming(true)} disabled={!valid}>
        Review decision
      </Button>

      <ConfirmDialog
        open={confirming}
        title="Move the money?"
        tone={resolution === 'release' ? 'primary' : 'danger'}
        confirmLabel="Confirm and send to PayHold"
        busy={mutation.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => mutation.mutate()}
        body={
          <div className="space-y-2">
            <p>{summary}</p>
            <p>
              PayHold carries this out as soon as you confirm, and it can&apos;t be undone. Both sides will see
              the outcome.
            </p>
          </div>
        }
      />
    </div>
  );
}

function SubTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-[var(--color-content-muted)]">
      {icon}
      {children}
    </h3>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="truncate text-[var(--color-content)]">{value}</dd>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="flex items-center gap-3">
            <Skeleton className="h-9 w-9" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-20 rounded-[var(--radius-pill)]" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
