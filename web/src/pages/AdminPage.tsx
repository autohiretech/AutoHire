import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  BarChart3,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Flag,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import type {
  Dispute,
  Flag as FlagType,
  KycMetrics,
  VerificationEvent,
  VerificationEventKind,
  VerificationReviewItem,
  VerificationStatus,
} from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/cn';
import { formatRwf, timeAgo } from '@/lib/format';
import {
  DISPUTE_STATUS_META,
  FLAG_REASON_LABEL,
  MODERATION_STATUS_META,
} from '@/lib/admin';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Spinner } from '@/components/ui';

type Tab = 'overview' | 'verification' | 'activity' | 'moderation' | 'disputes';

const DOC_TYPE_LABEL: Record<string, string> = {
  drivers_license: "Driver's license",
  national_id: 'National ID / passport',
  vehicle_registration: 'Vehicle registration',
  insurance_certificate: 'Proof of insurance',
  business_registration: 'Business registration',
};

/** Admin panel: overview, KYC review + activity, moderation, and disputes. */
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const { data: me } = useCurrentUser();

  const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: () => client.listFlags() });
  const disputesQuery = useQuery({ queryKey: ['disputes'], queryFn: () => client.listDisputes() });
  const hostsQuery = useQuery({ queryKey: ['hosts'], queryFn: () => client.listHosts() });
  const kycQuery = useQuery({ queryKey: ['kycMetrics'], queryFn: () => client.getKycMetrics() });

  const flags = flagsQuery.data ?? [];
  const disputes = disputesQuery.data ?? [];
  const hostsById = new Map((hostsQuery.data ?? []).map((h) => [h.id, h]));

  function nameOf(id: string): string {
    if (id === me?.id) return me.fullName;
    const h = hostsById.get(id);
    return h?.businessName ?? h?.fullName ?? id;
  }

  const openFlags = flags.filter((f) => f.status === 'open').length;
  const openDisputes = disputes.filter(
    (d) => d.status === 'open' || d.status === 'under_review',
  ).length;

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'verification', label: 'Verification', badge: kycQuery.data?.pendingDocs || undefined },
    { key: 'activity', label: 'KYC activity' },
    { key: 'moderation', label: 'Moderation', badge: openFlags || undefined },
    { key: 'disputes', label: 'Disputes', badge: openDisputes || undefined },
  ];

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink-900">Admin</h1>
      <p className="mt-1 text-sm text-ink-500">
        Platform overview, KYC verification, moderation, and disputes.
      </p>

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
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
        {tab === 'overview' && <OverviewTab kyc={kycQuery.data} />}
        {tab === 'verification' && <VerificationTab />}
        {tab === 'activity' && <ActivityTab />}
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
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewTab({ kyc }: { kyc?: KycMetrics }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['adminStats'],
    queryFn: () => client.getAdminStats(),
  });

  if (isLoading || !stats) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-700">Marketplace</h2>
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
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-700">KYC verification</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat icon={<Clock size={18} />} label="Docs awaiting review" value={`${kyc?.pendingDocs ?? '—'}`} />
          <Stat icon={<CheckCircle2 size={18} />} label="Verified users" value={`${kyc?.verifiedUsers ?? '—'}`} />
          <Stat icon={<Clock size={18} />} label="Pending users" value={`${kyc?.pendingUsers ?? '—'}`} />
          <Stat icon={<XCircle size={18} />} label="Rejected users" value={`${kyc?.rejectedUsers ?? '—'}`} />
          <Stat icon={<ShieldCheck size={18} />} label="Unverified users" value={`${kyc?.unverifiedUsers ?? '—'}`} />
          <Stat icon={<RefreshCw size={18} />} label="Decisions (7d)" value={`${kyc?.decisions7d ?? '—'}`} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification queue
// ---------------------------------------------------------------------------
const STATUS_FILTERS: { key: VerificationStatus | 'pending'; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
];

const PAGE_SIZE = 20;

function VerificationTab() {
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['verifications', status, term, page],
    queryFn: () => client.listVerifications({ status, search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-ink-200 p-0.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStatus(s.key as 'pending' | 'verified' | 'rejected');
                setPage(0);
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === s.key ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <form
          className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(search);
            setPage(0);
          }}
        >
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
          />
        </form>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Empty text={`No ${status} documents.`} />
      ) : (
        <>
          <div className="space-y-4">
            {data.items.map((v) => (
              <VerificationCard key={v.id} item={v} />
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data.total}
            onPage={setPage}
            busy={query.isFetching}
          />
        </>
      )}
    </div>
  );
}

/** One KYC document: preview the file, see history, then approve or reject. */
function VerificationCard({ item }: { item: VerificationReviewItem }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['verifications'] });
    queryClient.invalidateQueries({ queryKey: ['kycMetrics'] });
    queryClient.invalidateQueries({ queryKey: ['kycEvents'] });
    queryClient.invalidateQueries({ queryKey: ['adminStats'] });
  };
  const decide = useMutation({
    mutationFn: (v: { status: 'verified' | 'rejected'; note?: string }) =>
      client.reviewVerificationDocument(item.id, v.status, v.note),
    onSuccess: invalidate,
  });

  async function openDocument() {
    if (!item.storagePath) return;
    const url = await client.getKycDocumentUrl(item.storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const meta = STATUS_META[item.status];

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <Avatar name={item.owner.fullName} src={item.owner.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">{item.owner.fullName}</p>
          <p className="truncate text-xs text-ink-400">{item.owner.email}</p>
        </div>
        <Badge tone={meta.tone}>{DOC_TYPE_LABEL[item.type] ?? item.type}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-ink-700">
            <ShieldCheck size={15} className="text-ink-400" />
            <span className="truncate">{item.fileName ?? 'Document'}</span>
          </span>
          {item.storagePath ? (
            <button
              type="button"
              onClick={openDocument}
              className="inline-flex shrink-0 items-center gap-1 text-brand-700 hover:underline"
            >
              View <ExternalLink size={13} />
            </button>
          ) : (
            <span className="text-xs text-ink-400">No file</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          {item.uploadedAt && <span>Uploaded {timeAgo(item.uploadedAt)}</span>}
          {item.reviewedAt && <span>· Reviewed {timeAgo(item.reviewedAt)}</span>}
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-brand-700 hover:underline"
          >
            {showHistory ? 'Hide history' : 'History'}
          </button>
        </div>

        {item.status === 'rejected' && item.note && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{item.note}</p>
        )}

        {showHistory && <DocumentHistory profileId={item.owner.id} docType={item.type} />}

        {item.status === 'pending' &&
          (rejecting ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Reason shown to the applicant (e.g. photo is blurry)…"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={decide.isPending || !note.trim()}
                  onClick={() => decide.mutate({ status: 'rejected', note: note.trim() })}
                >
                  Confirm rejection
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ status: 'verified' })}>
                Approve
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

/** Inline per-document event history, loaded on demand. */
function DocumentHistory({ profileId, docType }: { profileId: string; docType: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['kycEvents', profileId],
    queryFn: () => client.listKycEvents({ profileId, pageSize: 50 }),
  });
  if (isLoading) return <Spinner size={16} />;
  const events = (data?.items ?? []).filter((e) => e.docType === docType);
  if (events.length === 0) return <p className="text-xs text-ink-400">No history.</p>;
  return (
    <ol className="space-y-1.5 border-l-2 border-ink-100 pl-3 text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex items-center gap-2">
          <EventDot kind={e.event} />
          <span className="font-medium text-ink-700">{EVENT_LABEL[e.event]}</span>
          {e.actorName && <span className="text-ink-400">by {e.actorName}</span>}
          <span className="ml-auto text-ink-400">{timeAgo(e.createdAt)}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// KYC activity feed
// ---------------------------------------------------------------------------
const ACTIVITY_PAGE_SIZE = 30;

function ActivityTab() {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['kycEvents', 'all', page],
    queryFn: () => client.listKycEvents({ page, pageSize: ACTIVITY_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  }
  if (!data || data.items.length === 0) {
    return <Empty text="No KYC activity yet." />;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="divide-y divide-ink-100 p-0">
          {data.items.map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </CardBody>
      </Card>
      <Pagination
        page={page}
        pageSize={ACTIVITY_PAGE_SIZE}
        total={data.total}
        onPage={setPage}
        busy={query.isFetching}
      />
    </div>
  );
}

function ActivityRow({ event }: { event: VerificationEvent }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <EventDot kind={event.event} />
      <div className="min-w-0 flex-1">
        <p className="text-ink-800">
          <span className="font-medium">{event.owner?.fullName ?? event.profileId}</span>
          <span className="text-ink-500"> · {DOC_TYPE_LABEL[event.docType] ?? event.docType}</span>
        </p>
        <p className="text-xs text-ink-400">
          {EVENT_LABEL[event.event]}
          {event.actorName ? ` by ${event.actorName}` : ''}
          {event.note ? ` — “${event.note}”` : ''}
        </p>
      </div>
      <span className="shrink-0 text-xs text-ink-400">{timeAgo(event.createdAt)}</span>
    </div>
  );
}

const EVENT_LABEL: Record<VerificationEventKind, string> = {
  submitted: 'Submitted',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  rejected: 'Rejected',
  updated: 'Updated',
};

const EVENT_TONE: Record<VerificationEventKind, string> = {
  submitted: 'bg-amber-400',
  resubmitted: 'bg-amber-400',
  approved: 'bg-emerald-500',
  rejected: 'bg-red-500',
  updated: 'bg-ink-300',
};

function EventDot({ kind }: { kind: VerificationEventKind }) {
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', EVENT_TONE[kind])} />;
}

const STATUS_META: Record<VerificationStatus, { tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  unverified: { tone: 'neutral' },
  pending: { tone: 'warning' },
  verified: { tone: 'success' },
  rejected: { tone: 'danger' },
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function Pagination({
  page,
  pageSize,
  total,
  onPage,
  busy,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-ink-500">
      <span>
        Page {page + 1} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0 || busy}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={15} /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= pages || busy}
          onClick={() => onPage(page + 1)}
        >
          Next <ChevronRight size={15} />
        </Button>
      </div>
    </div>
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

// ---------------------------------------------------------------------------
// Moderation + disputes (unchanged behaviour)
// ---------------------------------------------------------------------------
function FlagCard({ flag, reporter }: { flag: FlagType; reporter: string }) {
  const queryClient = useQueryClient();
  const meta = MODERATION_STATUS_META[flag.status];
  const mutation = useMutation({
    mutationFn: (status: FlagType['status']) => client.resolveFlag(flag.id, status),
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
    mutationFn: (status: Dispute['status']) => client.resolveDispute(dispute.id, status),
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
            <Button size="sm" onClick={() => mutation.mutate('resolved_renter')} disabled={mutation.isPending}>
              Favor renter
            </Button>
            <Button size="sm" onClick={() => mutation.mutate('resolved_host')} disabled={mutation.isPending}>
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
