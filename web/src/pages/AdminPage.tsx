import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  BarChart3,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  Flag,
  RefreshCw,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  User,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  AdminAction,
  AdminUser,
  Dispute,
  Flag as FlagType,
  KycMetrics,
  KycProfile,
  Listing,
  VerificationEvent,
  VerificationEventKind,
  VerificationReviewItem,
  VerificationStatus,
} from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf, timeAgo } from '@/lib/format';
import {
  DISPUTE_STATUS_META,
  FLAG_REASON_LABEL,
  MODERATION_STATUS_META,
} from '@/lib/admin';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Spinner } from '@/components/ui';
import { Img } from '@/components/Img';

type Tab = 'overview' | 'users' | 'verification' | 'activity' | 'moderation' | 'disputes';

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
    { key: 'users', label: 'Users' },
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
        {tab === 'users' && <UsersTab />}
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

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-700">Electric fleet rule</h2>
        <ElectricQuotaCard />
      </div>
    </div>
  );
}

/** Admin control for the platform's minimum electric-car percentage. */
function ElectricQuotaCard() {
  const queryClient = useQueryClient();
  const { data: quota } = useQuery({
    queryKey: ['electricQuota'],
    queryFn: () => client.getElectricQuota(),
  });
  const [pct, setPct] = useState<string>('');
  const save = useMutation({
    mutationFn: (p: number) => client.setElectricMinPercent(p),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['electricQuota'] }),
  });

  const current = quota?.minPercent ?? 95;
  const value = pct === '' ? String(current) : pct;
  const share =
    quota && quota.totalCars > 0 ? Math.round((quota.electricCars / quota.totalCars) * 100) : 0;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Zap size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900">Minimum electric cars</p>
            <p className="text-xs text-ink-500">
              Non-electric cars can’t be listed if it would drop the fleet below this. Machinery is
              exempt.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat icon={<Zap size={16} />} label="Electric cars" value={`${quota?.electricCars ?? '—'}`} />
          <Stat icon={<Car size={16} />} label="Total cars" value={`${quota?.totalCars ?? '—'}`} />
          <Stat icon={<BarChart3 size={16} />} label="Currently electric" value={`${share}%`} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="electric-pct">
              Required electric %
            </label>
            <div className="flex items-center gap-2">
              <input
                id="electric-pct"
                type="number"
                min={0}
                max={100}
                value={value}
                onChange={(e) => setPct(e.target.value)}
                className="w-24 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <span className="text-sm text-ink-500">%</span>
            </div>
          </div>
          <Button
            size="sm"
            disabled={
              save.isPending ||
              value === '' ||
              Number(value) === current ||
              Number(value) < 0 ||
              Number(value) > 100
            }
            onClick={() => save.mutate(Number(value))}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <span className="text-xs text-ink-400">Set 0 to turn the rule off.</span>
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const VERIF_TONE: Record<VerificationStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  verified: 'success',
  pending: 'warning',
  rejected: 'danger',
  unverified: 'neutral',
};

function UsersTab() {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['adminUsers', term, page],
    queryFn: () => client.listUsers({ search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <div className="space-y-4">
      <form
        className="relative"
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
          placeholder="Search users by name or email…"
          className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
        />
      </form>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Empty text="No users found." />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((u) => (
              <UserCard key={u.id} user={u} />
            ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} busy={query.isFetching} />
        </>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { renter: 'Renter', owner: 'Host', admin: 'Admin' };

function UserCard({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [compose, setCompose] = useState<null | 'message' | 'warn'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
  const suspend = useMutation({
    mutationFn: (next: boolean) => client.setUserSuspended(user.id, next),
    onSuccess: () => {
      refreshUsers();
      queryClient.invalidateQueries({ queryKey: ['userActions', user.id] });
    },
  });
  const remove = useMutation({
    mutationFn: () => client.deleteUser(user.id),
    onSuccess: () => {
      setConfirmDelete(false);
      refreshUsers();
    },
  });
  const send = useMutation({
    mutationFn: () =>
      compose === 'warn'
        ? client.warnUser(user.id, body)
        : client.sendUserMessage(user.id, title, body),
    onSuccess: () => {
      setCompose(null);
      setTitle('');
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['userActions', user.id] });
    },
  });

  return (
    <Card className={cn(user.suspended && 'border-red-200 bg-red-50/40')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Avatar name={user.fullName} src={user.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">{user.fullName}</p>
          <p className="truncate text-xs text-ink-400">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user.suspended && <Badge tone="danger">Suspended</Badge>}
          <span className="hidden rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 sm:inline">
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <Badge tone={VERIF_TONE[user.verification]}>{user.verification}</Badge>
          {open ? <ChevronUp size={16} className="text-ink-400" /> : <ChevronDown size={16} className="text-ink-400" />}
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-ink-100 px-4 py-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Detail label="Phone" value={user.phone || '—'} />
            <Detail label="Joined" value={user.joinedAt ? formatDate(user.joinedAt) : '—'} />
            <Detail label="Listings" value={`${user.listingCount}`} />
            <Detail label="Bookings" value={`${user.bookingCount}`} />
          </dl>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { setCompose('message'); setBody(''); }}>
              <Send size={14} /> Message
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCompose('warn'); setBody(''); }}>
              <AlertTriangle size={14} /> Warn
            </Button>
            {user.suspended ? (
              <Button size="sm" disabled={suspend.isPending} onClick={() => suspend.mutate(false)}>
                Reinstate
              </Button>
            ) : (
              <Button
                size="sm"
                variant="danger"
                disabled={suspend.isPending || user.role === 'admin'}
                onClick={() => suspend.mutate(true)}
              >
                <Ban size={14} /> Suspend
              </Button>
            )}
            {user.role !== 'admin' && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </Button>
            )}
          </div>

          <ConfirmDialog
            open={confirmDelete}
            tone="danger"
            title="Delete this user?"
            confirmLabel="Delete permanently"
            busy={remove.isPending}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => remove.mutate()}
            body={
              <>
                <p>
                  This permanently deletes <span className="font-medium">{user.fullName}</span> and
                  everything they own — listings, bookings, messages, reviews and documents. This
                  cannot be undone.
                </p>
                {remove.isError && (
                  <p className="mt-2 text-red-600">
                    {remove.error instanceof Error ? remove.error.message : 'Could not delete.'}
                  </p>
                )}
              </>
            }
          />

          {compose && (
            <div className="space-y-2 rounded-lg bg-ink-50 p-3">
              {compose === 'message' && (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Subject (optional)"
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              )}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder={compose === 'warn' ? 'Warning to this user…' : 'Message to this user…'}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              {send.isError && (
                <p className="text-sm text-red-600">
                  {send.error instanceof Error ? send.error.message : 'Could not send.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={compose === 'warn' ? 'danger' : 'primary'}
                  disabled={send.isPending || !body.trim()}
                  onClick={() => send.mutate()}
                >
                  {send.isPending ? 'Sending…' : compose === 'warn' ? 'Send warning' : 'Send message'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCompose(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {user.role === 'admin' && !user.suspended && (
            <p className="-mt-3 text-xs text-ink-400">Admins can’t be suspended from here.</p>
          )}

          <UserVerificationSection user={user} />
          <UserListingsSection hostId={user.id} count={user.listingCount} />
          <UserActivitySection userId={user.id} count={user.bookingCount} />
          <UserAdminLogSection userId={user.id} />
        </div>
      )}
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{children}</h3>;
}

/** Verification: override the overall status (incl. Unverify) + review documents. */
function UserVerificationSection({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const { data: docs, isLoading } = useQuery({
    queryKey: ['profileDocs', user.id],
    queryFn: () => client.listVerificationsForProfile(user.id),
  });
  const override = useMutation({
    mutationFn: (status: VerificationStatus) => client.overrideProfileVerification(user.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['userActions', user.id] });
    },
  });

  return (
    <div>
      <SectionTitle>Verification &amp; documents</SectionTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={override.isPending} onClick={() => override.mutate('verified')}>
          Verify
        </Button>
        <Button size="sm" variant="danger" disabled={override.isPending} onClick={() => override.mutate('rejected')}>
          Reject
        </Button>
        <Button size="sm" variant="outline" disabled={override.isPending} onClick={() => override.mutate('unverified')}>
          Unverify
        </Button>
      </div>
      {isLoading ? (
        <Spinner size={16} />
      ) : (docs ?? []).length === 0 ? (
        <p className="text-sm text-ink-400">No documents uploaded.</p>
      ) : (
        <div className="space-y-3">
          {(docs ?? []).map((d) => (
            <DocumentRow key={d.id} doc={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The user's listings (cars/machines they host) — click one for full details. */
function UserListingsSection({ hostId, count }: { hostId: string; count: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['userListings', hostId],
    queryFn: () => client.listUserListings(hostId),
    enabled: count > 0,
  });
  if (count === 0) return null;
  return (
    <div>
      <SectionTitle>Listings ({count})</SectionTitle>
      {isLoading ? (
        <Spinner size={16} />
      ) : (
        <div className="space-y-2">
          {(data ?? []).map((l: Listing) => (
            <ListingRow key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One listing: collapsed summary; click to expand its full details + bookings. */
function ListingRow({ listing: l }: { listing: Listing }) {
  const [open, setOpen] = useState(false);
  const price = `${formatRwf(l.pricePerDayRwf)}/day`;
  return (
    <div className="rounded-lg border border-ink-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
      >
        <Car size={15} className="shrink-0 text-ink-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-800">{l.title}</p>
          <p className="truncate text-xs text-ink-400">
            {l.make} {l.model} · {l.year} · {l.fuel} · {l.city}
          </p>
        </div>
        <span className="hidden shrink-0 text-xs text-ink-500 sm:inline">{price}</span>
        <Badge tone={l.status === 'available' ? 'success' : 'neutral'}>{l.status}</Badge>
        {open ? <ChevronUp size={15} className="text-ink-400" /> : <ChevronDown size={15} className="text-ink-400" />}
      </button>
      {open && <ListingDetail listing={l} />}
    </div>
  );
}

function ListingDetail({ listing: l }: { listing: Listing }) {
  const { data: bookings, isLoading } = useQuery({
    queryKey: ['listingBookings', l.id],
    queryFn: () => client.listListingBookings(l.id),
  });
  return (
    <div className="space-y-3 border-t border-ink-100 px-3 py-3">
      {l.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {l.photos.map((src) => (
            <Img
              key={src}
              src={src}
              alt={l.title}
              className="h-24 w-32 shrink-0 rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Detail label="Category" value={l.category} />
        <Detail label="Seats" value={`${l.seats}`} />
        <Detail label="Transmission" value={l.transmission} />
        <Detail label="Fuel" value={l.fuel} />
        <Detail label="Price/day" value={`${l.priceCurrency} ${l.pricePerDayRwf.toLocaleString()}`} />
        <Detail label="Booking" value={l.bookingMode} />
        <Detail label="Rating" value={l.ratingCount ? `${l.ratingAvg} (${l.ratingCount})` : '—'} />
        <Detail label="Country" value={l.country} />
      </dl>
      <div className="text-sm">
        <dt className="text-xs text-ink-500">Location</dt>
        <dd className="text-ink-800">
          {l.location}
          {l.locationUrl && (
            <>
              {' · '}
              <a href={l.locationUrl} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:underline">
                map link
              </a>
            </>
          )}
        </dd>
      </div>
      {l.features.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {l.features.map((f) => (
            <span key={f} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
              {f}
            </span>
          ))}
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-ink-500">
          Bookings on this car {bookings ? `(${bookings.length})` : ''}
        </p>
        {isLoading ? (
          <Spinner size={14} />
        ) : (bookings ?? []).length === 0 ? (
          <p className="text-xs text-ink-400">No bookings yet.</p>
        ) : (
          <div className="space-y-1.5">
            {(bookings ?? []).map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-xs">
                <Badge tone={BOOKING_TONE[b.state] ?? 'neutral'}>{b.state}</Badge>
                <span className="text-ink-600">
                  {formatDate(b.startDate)} → {formatDate(b.endDate)}
                </span>
                <span className="ml-auto text-ink-500">{formatRwf(b.totalRwf)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** What the user is doing — their bookings as renter or host. */
function UserActivitySection({ userId, count }: { userId: string; count: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['userBookings', userId],
    queryFn: () => client.listUserBookings(userId),
    enabled: count > 0,
  });
  if (count === 0) return null;
  return (
    <div>
      <SectionTitle>Bookings ({count})</SectionTitle>
      {isLoading ? (
        <Spinner size={16} />
      ) : (
        <div className="space-y-2">
          {(data ?? []).map((b) => (
            <div key={b.id} className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-800">{b.carTitle ?? b.listingId}</p>
                <p className="truncate text-xs text-ink-400">
                  {b.renterId === userId ? 'As renter' : 'As host'} · {formatDate(b.startDate)} →{' '}
                  {formatDate(b.endDate)}
                </p>
              </div>
              <span className="shrink-0 text-xs text-ink-500">{formatRwf(b.totalRwf)}</span>
              <Badge tone={BOOKING_TONE[b.state] ?? 'neutral'}>{b.state}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BOOKING_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  requested: 'warning',
  confirmed: 'accent',
  active: 'accent',
  completed: 'success',
  cancelled: 'neutral',
  declined: 'danger',
};

/** Every recorded admin action taken on this user. */
function UserAdminLogSection({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['userActions', userId],
    queryFn: () => client.listUserActions(userId),
  });
  return (
    <div>
      <SectionTitle>Admin action log</SectionTitle>
      {isLoading ? (
        <Spinner size={16} />
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-ink-400">No admin actions recorded.</p>
      ) : (
        <ol className="space-y-1.5 border-l-2 border-ink-100 pl-3 text-xs">
          {(data ?? []).map((a: AdminAction) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium text-ink-700">{ACTION_LABEL[a.action] ?? a.action}</span>
              {a.detail && <span className="text-ink-500">— {a.detail}</span>}
              {a.adminName && <span className="text-ink-400">by {a.adminName}</span>}
              <span className="ml-auto text-ink-400">{timeAgo(a.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  suspend: 'Suspended',
  reinstate: 'Reinstated',
  warn: 'Warning sent',
  message: 'Message sent',
  verification_override: 'Verification override',
  clear_override: 'Override cleared',
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification queue
// ---------------------------------------------------------------------------
const SCOPE_FILTERS: { key: 'pending' | 'all'; label: string }[] = [
  { key: 'pending', label: 'Needs review' },
  { key: 'all', label: 'All' },
];

const PAGE_SIZE = 20;

/** Platform switch: verify new submissions instantly, or hold them for review. */
function AutoApproveToggle() {
  const queryClient = useQueryClient();
  const { data: on, isLoading } = useQuery({
    queryKey: ['kycAutoApprove'],
    queryFn: () => client.getKycAutoApprove(),
  });
  const toggle = useMutation({
    mutationFn: (next: boolean) => client.setKycAutoApprove(next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kycAutoApprove'] });
      queryClient.invalidateQueries({ queryKey: ['verificationProfiles'] });
    },
  });
  const active = Boolean(on);
  const busy = isLoading || toggle.isPending;

  return (
    <Card
      className={cn(
        'border-2 transition-colors',
        active ? 'border-accent-400 bg-accent-400/5' : 'border-ink-200',
      )}
    >
      <CardBody className="flex items-center gap-4">
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors',
            active ? 'bg-accent-400/20 text-accent-600' : 'bg-brand-50 text-brand-600',
          )}
        >
          {active ? <Zap size={24} /> : <ShieldCheck size={24} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-ink-900">Auto-approve KYC</p>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                active ? 'bg-accent-500 text-white' : 'bg-ink-200 text-ink-600',
              )}
            >
              {active ? 'On' : 'Off'}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {active
              ? 'Documents are verified instantly — turning this on also cleared the pending queue.'
              : 'New documents wait in the queue for you to review. Turning this on verifies the whole queue.'}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label="Toggle auto-approve KYC"
          disabled={busy}
          onClick={() => toggle.mutate(!active)}
          className={cn(
            'relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            active
              ? 'bg-accent-500 focus-visible:ring-accent-500'
              : 'bg-ink-300 focus-visible:ring-ink-400',
            busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
          )}
        >
          <span
            className={cn(
              'absolute top-1 grid h-6 w-6 place-items-center rounded-full bg-white shadow-md transition-transform duration-200',
              active ? 'translate-x-7' : 'translate-x-1',
            )}
          >
            {active ? (
              <Zap size={12} className="text-accent-600" />
            ) : (
              <ShieldCheck size={12} className="text-ink-400" />
            )}
          </span>
        </button>
      </CardBody>
    </Card>
  );
}

/** KYC review queue — grouped by PERSON. Expand a person to review their docs. */
function VerificationTab() {
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['verificationProfiles', scope, term, page],
    queryFn: () => client.listVerificationProfiles({ scope, search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <div className="space-y-4">
      <AutoApproveToggle />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-ink-200 p-0.5">
          {SCOPE_FILTERS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setScope(s.key);
                setPage(0);
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                scope === s.key ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800',
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
        <Empty text={scope === 'pending' ? 'Nobody is awaiting review.' : 'No one has uploaded documents.'} />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((p) => (
              <PersonCard key={p.id} person={p} />
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

const invalidateKyc = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['verificationProfiles'] });
  qc.invalidateQueries({ queryKey: ['kycMetrics'] });
  qc.invalidateQueries({ queryKey: ['kycEvents'] });
  qc.invalidateQueries({ queryKey: ['adminStats'] });
  qc.invalidateQueries({ queryKey: ['profileDocs'] });
};

/** One PERSON in the queue. Collapsed by default; expand to review their docs. */
function PersonCard({ person }: { person: KycProfile }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[person.verification];
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Avatar name={person.fullName} src={person.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">{person.fullName}</p>
          <p className="truncate text-xs text-ink-400">{person.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {person.pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {person.pendingCount} to review
            </span>
          )}
          <Badge tone={meta.tone}>
            {person.verification}
            {person.verificationOverride ? ' (override)' : ''}
          </Badge>
          {open ? <ChevronUp size={16} className="text-ink-400" /> : <ChevronDown size={16} className="text-ink-400" />}
        </div>
      </button>
      {open && <PersonReview person={person} />}
    </Card>
  );
}

/** Expanded review area: the person's documents + a profile-level override. */
function PersonReview({ person }: { person: KycProfile }) {
  const queryClient = useQueryClient();
  const { data: docs, isLoading } = useQuery({
    queryKey: ['profileDocs', person.id],
    queryFn: () => client.listVerificationsForProfile(person.id),
  });

  const override = useMutation({
    mutationFn: (v: { status: VerificationStatus }) =>
      client.overrideProfileVerification(person.id, v.status),
    onSuccess: () => invalidateKyc(queryClient),
  });
  const clearOverride = useMutation({
    mutationFn: () => client.clearVerificationOverride(person.id),
    onSuccess: () => invalidateKyc(queryClient),
  });

  return (
    <div className="space-y-3 border-t border-ink-100 px-4 py-3">
      {isLoading ? (
        <Spinner size={18} />
      ) : (
        (docs ?? []).map((d) => <DocumentRow key={d.id} doc={d} />)
      )}

      <div className="rounded-lg bg-ink-50 px-3 py-2.5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Override overall status
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={override.isPending}
            onClick={() => override.mutate({ status: 'verified' })}
          >
            Force verified
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={override.isPending}
            onClick={() => override.mutate({ status: 'rejected' })}
          >
            Force rejected
          </Button>
          {person.verificationOverride && (
            <Button
              variant="outline"
              size="sm"
              disabled={clearOverride.isPending}
              onClick={() => clearOverride.mutate()}
            >
              Clear override
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          An override sticks — it won’t be recomputed when the user changes documents.
          {person.verificationOverride ? ' This user is currently overridden.' : ''}
        </p>
      </div>
    </div>
  );
}

/** One document row inside a person's review: view + approve/reject at any status. */
function DocumentRow({ doc }: { doc: VerificationReviewItem }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (v: { status: 'verified' | 'rejected'; note?: string }) =>
      client.reviewVerificationDocument(doc.id, v.status, v.note),
    onSuccess: () => {
      invalidateKyc(queryClient);
      setRejecting(false);
      setNote('');
    },
  });

  async function openDocument() {
    if (!doc.storagePath) return;
    const url = await client.getKycDocumentUrl(doc.storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const meta = STATUS_META[doc.status];

  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-ink-800">
          {DOC_TYPE_LABEL[doc.type] ?? doc.type}
        </span>
        <Badge tone={meta.tone}>{doc.status}</Badge>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 text-ink-700">
          <ShieldCheck size={15} className="shrink-0 text-ink-400" />
          <span className="truncate">{doc.fileName ?? 'Document'}</span>
        </span>
        {doc.storagePath ? (
          <button
            type="button"
            onClick={openDocument}
            className="inline-flex shrink-0 items-center gap-1 text-brand-700 hover:underline"
          >
            View <ExternalLink size={13} />
          </button>
        ) : (
          <span className="shrink-0 text-xs text-ink-400">No file (legacy)</span>
        )}
      </div>

      <p className="mt-1.5 text-xs text-ink-400">
        {doc.uploadedAt && <>Uploaded {timeAgo(doc.uploadedAt)}</>}
        {doc.reviewedAt && <> · Reviewed {timeAgo(doc.reviewedAt)}</>}
      </p>

      {doc.status === 'rejected' && doc.note && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{doc.note}</p>
      )}

      {rejecting ? (
        <div className="mt-2 space-y-2">
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
        <div className="mt-2 flex flex-wrap gap-2">
          {doc.status !== 'verified' && (
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ status: 'verified' })}>
              Approve
            </Button>
          )}
          {doc.status !== 'rejected' && (
            <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          )}
        </div>
      )}
    </div>
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
          <span className="text-ink-500">
            {' · '}
            {event.docType ? DOC_TYPE_LABEL[event.docType] ?? event.docType : 'Overall status'}
          </span>
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
  override: 'Admin override',
  updated: 'Updated',
};

const EVENT_TONE: Record<VerificationEventKind, string> = {
  submitted: 'bg-amber-400',
  resubmitted: 'bg-amber-400',
  approved: 'bg-emerald-500',
  rejected: 'bg-red-500',
  override: 'bg-brand-500',
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
