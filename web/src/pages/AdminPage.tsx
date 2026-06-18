import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Car, Flag, Scale, User } from 'lucide-react';
import type { Dispute, Flag as FlagType } from '@autohire/shared';
import { mockClient } from '@/mocks/client';
import { currentUser } from '@/mocks/data';
import { cn } from '@/lib/cn';
import { formatRwf, timeAgo } from '@/lib/format';
import {
  DISPUTE_STATUS_META,
  FLAG_REASON_LABEL,
  MODERATION_STATUS_META,
} from '@/lib/admin';
import { Badge, Button, Card, CardBody, CardHeader, Spinner } from '@/components/ui';

type Tab = 'moderation' | 'disputes' | 'reporting';

/** A9 — Admin panel: moderation queue, dispute resolution, and reporting. */
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('moderation');

  const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: () => mockClient.listFlags() });
  const disputesQuery = useQuery({
    queryKey: ['disputes'],
    queryFn: () => mockClient.listDisputes(),
  });
  const hostsQuery = useQuery({ queryKey: ['hosts'], queryFn: () => mockClient.listHosts() });

  const flags = flagsQuery.data ?? [];
  const disputes = disputesQuery.data ?? [];
  const hostsById = new Map((hostsQuery.data ?? []).map((h) => [h.id, h]));

  function nameOf(id: string): string {
    if (id === currentUser.id) return currentUser.fullName;
    const h = hostsById.get(id);
    return h?.businessName ?? h?.fullName ?? id;
  }

  const openFlags = flags.filter((f) => f.status === 'open').length;
  const openDisputes = disputes.filter(
    (d) => d.status === 'open' || d.status === 'under_review',
  ).length;

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'moderation', label: 'Moderation', badge: openFlags || undefined },
    { key: 'disputes', label: 'Disputes', badge: openDisputes || undefined },
    { key: 'reporting', label: 'Reporting' },
  ];

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink-900">Admin</h1>
      <p className="mt-1 text-sm text-ink-500">Moderation, disputes, and platform reporting.</p>

      <div className="mt-6 flex gap-1 border-b border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
          >
            {t.label}
            {t.badge !== undefined && (
              <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'moderation' && (
          <TabState query={flagsQuery}>
            {flags.length === 0 ? (
              <Empty text="Nothing flagged." />
            ) : (
              <div className="space-y-4">
                {flags.map((f) => (
                  <FlagCard key={f.id} flag={f} reporter={nameOf(f.reportedBy)} />
                ))}
              </div>
            )}
          </TabState>
        )}

        {tab === 'disputes' && (
          <TabState query={disputesQuery}>
            {disputes.length === 0 ? (
              <Empty text="No disputes." />
            ) : (
              <div className="space-y-4">
                {disputes.map((d) => (
                  <DisputeCard
                    key={d.id}
                    dispute={d}
                    raisedByName={nameOf(d.raisedBy)}
                    againstName={nameOf(d.against)}
                  />
                ))}
              </div>
            )}
          </TabState>
        )}

        {tab === 'reporting' && <Reporting />}
      </div>
    </section>
  );
}

function TabState({ query, children }: { query: { isLoading: boolean }; children: React.ReactNode }) {
  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  }
  return <>{children}</>;
}

function Empty({ text }: { text: string }) {
  return (
    <Card>
      <CardBody className="py-12 text-center text-sm text-ink-500">{text}</CardBody>
    </Card>
  );
}

function FlagCard({ flag, reporter }: { flag: FlagType; reporter: string }) {
  const queryClient = useQueryClient();
  const meta = MODERATION_STATUS_META[flag.status];
  const mutation = useMutation({
    mutationFn: (status: FlagType['status']) => mockClient.resolveFlag(flag.id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['flags'] }),
  });
  const open = flag.status === 'open';

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <span className="text-ink-400">
          {flag.targetType === 'listing' ? <Car size={16} /> : <User size={16} />}
        </span>
        <span className="flex-1 truncate font-medium text-ink-900">{flag.targetLabel}</span>
        <Badge tone="danger">{FLAG_REASON_LABEL[flag.reason]}</Badge>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-700">{flag.detail}</p>
        <p className="text-xs text-ink-400">
          Reported by {reporter} · {timeAgo(flag.createdAt)}
        </p>
        {open && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => mutation.mutate('approved')} disabled={mutation.isPending}>
              Keep
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => mutation.mutate('removed')}
              disabled={mutation.isPending}
            >
              Remove
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutation.mutate('dismissed')}
              disabled={mutation.isPending}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DisputeCard({
  dispute,
  raisedByName,
  againstName,
}: {
  dispute: Dispute;
  raisedByName: string;
  againstName: string;
}) {
  const queryClient = useQueryClient();
  const meta = DISPUTE_STATUS_META[dispute.status];
  const mutation = useMutation({
    mutationFn: (status: Dispute['status']) => mockClient.resolveDispute(dispute.id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] }),
  });
  const actionable = dispute.status === 'open' || dispute.status === 'under_review';

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink-900">{formatRwf(dispute.amountRwf)} claim</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-700">{dispute.reason}</p>
        <p className="text-xs text-ink-400">
          {raisedByName} vs {againstName} · booking {dispute.bookingId} · {timeAgo(dispute.createdAt)}
        </p>
        {actionable && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => mutation.mutate('resolved_renter')}
              disabled={mutation.isPending}
            >
              Favor renter
            </Button>
            <Button
              size="sm"
              onClick={() => mutation.mutate('resolved_host')}
              disabled={mutation.isPending}
            >
              Favor host
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutation.mutate('dismissed')}
              disabled={mutation.isPending}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Reporting() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['adminStats'],
    queryFn: () => mockClient.getAdminStats(),
  });

  if (isLoading || !stats) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Stat icon={<BarChart3 size={18} />} label="Gross bookings" value={formatRwf(stats.grossRwf)} />
      <Stat icon={<BarChart3 size={18} />} label="Platform revenue" value={formatRwf(stats.revenueRwf)} />
      <Stat icon={<BarChart3 size={18} />} label="Payouts paid" value={formatRwf(stats.payoutsPaidRwf)} />
      <Stat icon={<BarChart3 size={18} />} label="Payouts due" value={formatRwf(stats.payoutsDueRwf)} />
      <Stat icon={<Car size={18} />} label="Listings" value={`${stats.listings}`} />
      <Stat icon={<User size={18} />} label="Hosts" value={`${stats.hosts}`} />
      <Stat icon={<BarChart3 size={18} />} label="Bookings" value={`${stats.bookings}`} />
      <Stat icon={<Flag size={18} />} label="Open flags" value={`${stats.openFlags}`} />
      <Stat icon={<Scale size={18} />} label="Open disputes" value={`${stats.openDisputes}`} />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          {icon}
        </span>
        <div>
          <p className="text-xs text-ink-500">{label}</p>
          <p className="font-semibold text-ink-900">{value}</p>
        </div>
      </CardBody>
    </Card>
  );
}
