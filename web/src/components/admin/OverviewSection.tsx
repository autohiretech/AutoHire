import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Flag, Scale, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';
import type { AdminMoneyByCurrency } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { CURRENCIES, formatMoney, isCurrencyCode } from '@/lib/currency';
import { Button, Card, Input, Label, Skeleton } from '@/components/ui';

/** An amount in its own currency, at that currency's natural precision. */
function money(amount: number, currency: string): string {
  return formatMoney(amount, currency, {
    decimals: isCurrencyCode(currency) ? CURRENCIES[currency].decimals : 0,
  });
}

const n = (v: number) => v.toLocaleString();

/**
 * Admin → Overview: what needs a decision first, then money per currency, then
 * the shape of the platform.
 *
 * Built as a few grouped panels rather than a wall of identical tiles. The old
 * grid gave "Gross bookings" and "Open flags" the same box, icon and weight, so
 * nothing on the page said where to look; the queues now lead, and each links
 * straight to the place the work is done.
 */
export function OverviewSection() {
  const overview = useQuery({ queryKey: ['adminOverview'], queryFn: () => client.getAdminOverview() });
  const kyc = useQuery({ queryKey: ['kycMetrics'], queryFn: () => client.getKycMetrics() });

  if (overview.isLoading || !overview.data) {
    return overview.isError ? (
      <Card className="p-6 text-body-sm text-[var(--color-danger-500)]">
        Couldn&apos;t load the overview: {overview.error instanceof Error ? overview.error.message : 'unknown error'}
      </Card>
    ) : (
      <OverviewSkeleton />
    );
  }
  const o = overview.data;
  const k = kyc.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AttentionTile
          to="/verification"
          icon={ShieldCheck}
          label="Documents to review"
          count={k?.pendingDocs}
        />
        <AttentionTile to="/disputes" icon={Scale} label="Open disputes" count={o.openDisputes} />
        <AttentionTile to="/moderation" icon={Flag} label="Open reports" count={o.openFlags} />
      </div>
      {o.failedPayouts > 0 && (
        <div className="flex items-start gap-3 rounded-[var(--radius-card)] bg-[var(--color-danger-tint)] px-4 py-3 text-body-sm text-[var(--color-danger-500)]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {o.failedPayouts === 1 ? '1 host payout failed' : `${o.failedPayouts} host payouts failed`} and is
          still owed. It&apos;s counted under &ldquo;Owed to hosts&rdquo; below.
        </div>
      )}

      <Panel
        title="Money"
        description="Each amount stays in the currency its car is priced in. Different currencies are never added together."
      >
        {o.money.length === 0 ? (
          <p className="px-5 py-10 text-center text-body-sm text-[var(--color-content-muted)]">
            No paid bookings or payouts yet. Each currency gets its own row here once renters pay.
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-line)]">
            {o.money.map((m) => (
              <CurrencyRow key={m.currency} m={m} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Bookings" description={`${n(o.bookings.total)} in total`}>
        <MetricGrid
          items={[
            { label: 'Paid', value: n(o.bookings.paid) },
            { label: 'Awaiting payment', value: n(o.bookings.awaitingPayment) },
            { label: 'Refunded', value: n(o.bookings.refunded) },
            { label: 'Upcoming', value: n(o.bookings.upcoming) },
            { label: 'On a trip now', value: n(o.bookings.onTrip) },
            { label: 'Completed', value: n(o.bookings.completed) },
            { label: 'Cancelled or declined', value: n(o.bookings.cancelled) },
            { label: 'Listings', value: n(o.listings) },
          ]}
        />
      </Panel>

      <Panel
        title="Verification"
        description={k ? `${n(k.decisions7d)} decisions in the last 7 days` : undefined}
        action={
          <Link
            to="/verification"
            className="inline-flex items-center gap-1 text-body-sm font-medium text-[var(--color-accent-on)] hover:underline"
          >
            Open review <ArrowRight size={14} />
          </Link>
        }
      >
        <VerificationBreakdown
          verified={k?.verifiedUsers}
          pending={k?.pendingUsers}
          rejected={k?.rejectedUsers}
          unverified={k?.unverifiedUsers}
        />
      </Panel>

      <Panel title="People" description={`${n(o.people.users)} accounts`}>
        <MetricGrid
          items={[
            { label: 'Renters', value: n(o.people.renters) },
            { label: 'Hosts', value: n(o.people.hosts) },
            { label: 'Admins', value: n(o.people.admins) },
            { label: 'All accounts', value: n(o.people.users) },
          ]}
        />
      </Panel>

      <ElectricQuotaPanel />
    </div>
  );
}

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-h4 text-[var(--color-content)]">{title}</h2>
          {description && <p className="text-caption text-[var(--color-content-subtle)]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A queue with work in it is tinted and says how much; an empty one reads as
 * done, so the three tiles answer "is anything waiting on me?" at a glance. */
function AttentionTile({
  to,
  icon: Icon,
  label,
  count,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  count: number | undefined;
}) {
  const waiting = (count ?? 0) > 0;
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3.5 transition-colors',
        waiting
          ? 'border-[color-mix(in_srgb,var(--color-warn-500)_35%,transparent)] bg-[var(--color-warn-tint)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface-raised)] hover:bg-[var(--color-surface-sunken)]',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
          waiting
            ? 'bg-[var(--color-warn-500)] text-white'
            : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
        )}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm text-[var(--color-content-muted)]">{label}</span>
        <span className="tabular block text-h3 text-[var(--color-content)]">
          {count === undefined ? '—' : waiting ? n(count) : 'All clear'}
        </span>
      </span>
      <ArrowRight
        size={16}
        className="shrink-0 text-[var(--color-content-subtle)] transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/** Label/value pairs on a hairline grid. Always 4 or 8 items, so the grid
 * never leaves a hole at 2 or 4 columns. */
function MetricGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px bg-[var(--color-line)] sm:grid-cols-4">
      {items.map((m) => (
        <div key={m.label} className="bg-[var(--color-surface-raised)] px-4 py-3.5 sm:px-5">
          <dt className="truncate text-caption text-[var(--color-content-muted)]">{m.label}</dt>
          <dd className="tabular mt-0.5 text-h4 text-[var(--color-content)]">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CurrencyRow({ m }: { m: AdminMoneyByCurrency }) {
  const cells: { label: string; value: number; tone?: 'muted' | 'warn' }[] = [
    { label: 'Collected', value: m.gross },
    { label: 'AutoHire fees', value: m.revenue },
    { label: 'Held until trips end', value: m.held, tone: 'muted' },
    { label: 'Refunded', value: m.refunded, tone: 'muted' },
    { label: 'Paid to hosts', value: m.payoutsPaid },
    { label: 'Owed to hosts', value: m.payoutsDue, tone: m.payoutsDue > 0 ? 'warn' : 'muted' },
  ];
  return (
    <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-center">
      <div>
        <p className="text-h3 text-[var(--color-content)]">{m.currency}</p>
        <p className="tabular text-caption text-[var(--color-content-subtle)]">
          {m.paidBookings === 1 ? '1 paid booking' : `${n(m.paidBookings)} paid bookings`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <dt className="truncate text-caption text-[var(--color-content-muted)]">{c.label}</dt>
            <dd
              className={cn(
                'tabular truncate font-semibold',
                c.tone === 'warn' ? 'text-[var(--color-warn-500)]' : 'text-[var(--color-content)]',
                c.tone === 'muted' && c.value === 0 && 'text-[var(--color-content-subtle)]',
              )}
            >
              {money(c.value, m.currency)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function VerificationBreakdown({
  verified = 0,
  pending = 0,
  rejected = 0,
  unverified = 0,
}: {
  verified?: number;
  pending?: number;
  rejected?: number;
  unverified?: number;
}) {
  const total = verified + pending + rejected + unverified;
  const parts = [
    { label: 'Verified', value: verified, color: 'bg-[var(--color-accent-on)]' },
    { label: 'In review', value: pending, color: 'bg-[var(--color-warn-500)]' },
    { label: 'Rejected', value: rejected, color: 'bg-[var(--color-danger-500)]' },
    { label: 'Not verified', value: unverified, color: 'bg-[var(--color-line-strong)]' },
  ];
  return (
    <div>
      <div className="px-4 pt-4 sm:px-5">
        <div className="flex h-2 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)]">
          {total > 0 &&
            parts.map((p) =>
              p.value > 0 ? (
                <span key={p.label} className={p.color} style={{ width: `${(p.value / total) * 100}%` }} />
              ) : null,
            )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-px border-t border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-4">
        {parts.map((p) => (
          <div key={p.label} className="bg-[var(--color-surface-raised)] px-4 py-3.5 sm:px-5">
            <dt className="flex items-center gap-1.5 text-caption text-[var(--color-content-muted)]">
              <span className={cn('h-2 w-2 rounded-full', p.color)} />
              {p.label}
            </dt>
            <dd className="tabular mt-0.5 text-h4 text-[var(--color-content)]">
              {n(p.value)}
              {total > 0 && (
                <span className="ml-1.5 text-caption font-normal text-[var(--color-content-subtle)]">
                  {Math.round((p.value / total) * 100)}%
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Admin control for the platform's minimum electric-car percentage. */
function ElectricQuotaPanel() {
  const queryClient = useQueryClient();
  const { data: quota } = useQuery({
    queryKey: ['electricQuota'],
    queryFn: () => client.getElectricQuota(),
  });
  const [pct, setPct] = useState<string>('');
  const save = useMutation({
    mutationFn: (p: number) => client.setElectricMinPercent(p),
    onSuccess: () => {
      setPct('');
      queryClient.invalidateQueries({ queryKey: ['electricQuota'] });
    },
  });

  const current = quota?.minPercent ?? 95;
  const value = pct === '' ? String(current) : pct;
  const share =
    quota && quota.totalCars > 0 ? Math.round((quota.electricCars / quota.totalCars) * 100) : 0;
  const invalid = value === '' || Number(value) < 0 || Number(value) > 100;

  return (
    <Panel
      title="Electric fleet rule"
      description="Non-electric cars can't be listed if it would drop the fleet below this. Machinery is exempt."
    >
      <MetricGrid
        items={[
          { label: 'Electric cars', value: quota ? n(quota.electricCars) : '—' },
          { label: 'All cars', value: quota ? n(quota.totalCars) : '—' },
          { label: 'Electric now', value: quota ? `${share}%` : '—' },
          { label: 'Required', value: `${current}%` },
        ]}
      />
      <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-line)] px-4 py-4 sm:px-5">
        <div>
          <Label htmlFor="electric-pct">Required electric share</Label>
          <div className="flex items-center gap-2">
            <Input
              id="electric-pct"
              type="number"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setPct(e.target.value)}
              className="tabular w-24"
            />
            <span className="text-body-sm text-[var(--color-content-muted)]">%</span>
          </div>
        </div>
        <Button
          size="sm"
          disabled={save.isPending || invalid || Number(value) === current}
          onClick={() => save.mutate(Number(value))}
        >
          <Zap size={14} /> {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <span className="text-caption text-[var(--color-content-subtle)]">Set 0 to turn the rule off.</span>
      </div>
    </Panel>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] w-full" />
        ))}
      </div>
      {[180, 150, 140, 110].map((h, i) => (
        <Skeleton key={i} className="w-full" style={{ height: h }} />
      ))}
    </div>
  );
}
