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
import { listingHeadlinePrice } from '@/lib/pricing';
import {
  DISPUTE_STATUS_META,
  FLAG_REASON_LABEL,
  MODERATION_STATUS_META,
} from '@/lib/admin';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Chip, ConfirmDialog, Input, Label, Skeleton, Spinner, toast } from '@/components/ui';
import { PhotoCarousel } from '@/components/PhotoCarousel';
import { Navigate, useLocation } from 'react-router-dom';
import { sectionForPath } from '@/components/admin/AdminSidebar';

/**
 * Tell PayHold what AutoHire now says about this person, and say what happened.
 *
 * Runs after the AutoHire decision has already been saved, so nothing here can
 * undo it or make it look failed. The Edge Function reads the stored status
 * itself — this only passes the profile id.
 *
 * Verifying someone is not the same as making them payable: PayHold still
 * checks each payout account separately, so the success message says so
 * rather than implying money will now move.
 */
async function relayVerificationToPayhold(
  profileId: string,
  opts: { quietUnlessVerified?: boolean } = {},
) {
  try {
    const r = await client.syncHostVerificationToPayhold(profileId);
    switch (r.payhold) {
      case 'verified':
        toast.success(
          'Verified in PayHold too. Their payout account still needs its own check before money can be sent.',
        );
        break;
      case 'unverified':
        // A single document approval usually leaves the person pending, which
        // relays "not verified" — true, but not news, so it stays quiet.
        if (!opts.quietUnlessVerified) toast.info('PayHold now shows this person as not verified.');
        break;
      case 'not_trusted_yet':
        toast.info(
          "Saved in AutoHire. PayHold hasn't been told to accept AutoHire's checks yet — in PayHold, open Settings and turn on \u201cI review each seller myself and tell PayHold the result\u201d.",
        );
        break;
      case 'failed':
        toast.error(
          `Saved in AutoHire, but PayHold couldn't be updated${r.error ? `: ${r.error}` : ''}. Pressing the button again is safe.`,
        );
        break;
      // 'not_registered': most people in this queue are renters, with no PayHold
      // seller to update. Nothing to say.
    }
  } catch (e) {
    toast.error(
      `Saved in AutoHire, but PayHold couldn't be reached: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const DOC_TYPE_LABEL: Record<string, string> = {
  drivers_license: "Driver's license",
  national_id: 'National ID / passport',
  vehicle_registration: 'Vehicle registration',
  insurance_certificate: 'Proof of insurance',
  business_registration: 'Business registration',
};

/**
 * Admin panel: overview, KYC review + activity, moderation, and disputes.
 * The section comes from the URL — the sidebar (`AdminLayout`) links to each
 * one — so a path the admin site doesn't have goes back to the overview.
 */
export function AdminPage() {
  const { pathname } = useLocation();
  const section = sectionForPath(pathname);
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

  if (!section) return <Navigate to="/" replace />;
  const tab = section.key;

  return (
    <section className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-h2 text-[var(--color-content)]">{section.label}</h1>
      <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">{section.description}</p>

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
    return <OverviewSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 px-1 text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
          Marketplace
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        <h2 className="mb-3 px-1 text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
          KYC verification
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat icon={<Clock size={18} />} label="Docs awaiting review" value={`${kyc?.pendingDocs ?? '—'}`} />
          <Stat icon={<CheckCircle2 size={18} />} label="Verified users" value={`${kyc?.verifiedUsers ?? '—'}`} />
          <Stat icon={<Clock size={18} />} label="Pending users" value={`${kyc?.pendingUsers ?? '—'}`} />
          <Stat icon={<XCircle size={18} />} label="Rejected users" value={`${kyc?.rejectedUsers ?? '—'}`} />
          <Stat icon={<ShieldCheck size={18} />} label="Unverified users" value={`${kyc?.unverifiedUsers ?? '—'}`} />
          <Stat icon={<RefreshCw size={18} />} label="Decisions (7d)" value={`${kyc?.decisions7d ?? '—'}`} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 px-1 text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
          Electric fleet rule
        </h2>
        <ElectricQuotaCard />
      </div>
    </div>
  );
}

/** Placeholder for the Overview tab — the two `Stat` tile grids (Marketplace,
    KYC verification) plus the electric-fleet card, sized to match so nothing
    jumps once `adminStats`/`kycMetrics` land. */
function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div>
        <Skeleton className="mb-3 ml-1 h-3 w-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 ml-1 h-3 w-32" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 ml-1 h-3 w-36" />
        <Skeleton className="h-44 w-full" />
      </div>
    </div>
  );
}

/** Matches `Stat`'s icon-square + caption + value layout. */
function StatSkeleton() {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>
      </CardBody>
    </Card>
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
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
            <Zap size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--color-content)]">Minimum electric cars</p>
            <p className="text-body-sm text-[var(--color-content-muted)]">
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
            <Label htmlFor="electric-pct">Required electric %</Label>
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
          <span className="text-caption text-[var(--color-content-subtle)]">Set 0 to turn the rule off.</span>
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
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or email…"
          className="pl-9"
        />
      </form>

      {query.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <PersonRowSkeleton key={i} />
          ))}
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

/** Matches the collapsed row shared by `UserCard` and `PersonCard` — avatar,
    name + email lines, and a badge on the right. */
function PersonRowSkeleton() {
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-5 w-16 rounded-[var(--radius-pill)]" />
      </div>
    </Card>
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
    <Card className={cn(user.suspended && 'border-l-4 border-l-[var(--color-danger-500)]')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Avatar name={user.fullName} src={user.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-[var(--color-content)]">{user.fullName}</p>
          <p className="truncate text-caption text-[var(--color-content-subtle)]">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user.suspended && <Badge tone="danger">Suspended</Badge>}
          <Badge tone="neutral" className="hidden sm:inline-flex">
            {ROLE_LABEL[user.role] ?? user.role}
          </Badge>
          <Badge tone={VERIF_TONE[user.verification]}>{user.verification}</Badge>
          {open ? (
            <ChevronUp size={16} className="text-[var(--color-content-subtle)]" />
          ) : (
            <ChevronDown size={16} className="text-[var(--color-content-subtle)]" />
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-[var(--color-line)] px-4 py-4">
          <dl className="grid grid-cols-2 gap-3 text-body-sm sm:grid-cols-4">
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
                  <p className="mt-2 text-[var(--color-danger-500)]">
                    {remove.error instanceof Error ? remove.error.message : 'Could not delete.'}
                  </p>
                )}
              </>
            }
          />

          {compose && (
            <div className="space-y-2 rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] p-3">
              {compose === 'message' && (
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Subject (optional)"
                />
              )}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder={compose === 'warn' ? 'Warning to this user…' : 'Message to this user…'}
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] focus:outline-none"
              />
              {send.isError && (
                <p className="text-body-sm text-[var(--color-danger-500)]">
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
            <p className="-mt-3 text-caption text-[var(--color-content-subtle)]">
              Admins can’t be suspended from here.
            </p>
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
  return (
    <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
      {children}
    </h3>
  );
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
      void relayVerificationToPayhold(user.id);
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
        <p className="text-body-sm text-[var(--color-content-subtle)]">No documents uploaded.</p>
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
  const headline = listingHeadlinePrice(l);
  const price = `${formatRwf(headline.amount)}/${headline.unit}`;
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-body-sm"
      >
        <Car size={15} className="shrink-0 text-[var(--color-content-subtle)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-[var(--color-content)]">{l.title}</p>
          <p className="truncate text-caption text-[var(--color-content-subtle)]">
            {l.make} {l.model} · {l.year} · {l.fuel} · {l.city}
          </p>
        </div>
        <span className="tabular hidden shrink-0 text-caption text-[var(--color-content-muted)] sm:inline">
          {price}
        </span>
        <Badge tone={l.status === 'available' ? 'success' : 'neutral'}>{l.status}</Badge>
        {open ? (
          <ChevronUp size={15} className="text-[var(--color-content-subtle)]" />
        ) : (
          <ChevronDown size={15} className="text-[var(--color-content-subtle)]" />
        )}
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
    <div className="space-y-4 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)]/50 px-3 py-4">
      <PhotoCarousel photos={l.photos} alt={l.title} heightClass="h-52" />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-line)] text-body-sm sm:grid-cols-4">
        <Spec label="Category" value={l.category} />
        <Spec label="Seats" value={`${l.seats}`} />
        <Spec label="Transmission" value={l.transmission} />
        <Spec label="Fuel" value={l.fuel} highlight={l.fuel === 'electric'} />
        <Spec
          label={l.pricingMode === 'hourly' ? 'Price / hour' : 'Price / day'}
          value={`${l.priceCurrency} ${listingHeadlinePrice(l).amount.toLocaleString()}`}
        />
        <Spec label="Rating" value={l.ratingCount ? `${l.ratingAvg} (${l.ratingCount})` : '—'} />
        <Spec label="Country" value={l.country} />
      </dl>

      <div className="text-body-sm">
        <p className="text-caption font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">
          Location
        </p>
        <p className="mt-0.5 text-[var(--color-content)]">
          {l.location}
          {l.locationUrl && (
            <>
              {' · '}
              <a
                href={l.locationUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--color-accent-on)] hover:underline"
              >
                map link
              </a>
            </>
          )}
        </p>
      </div>

      {l.features.length > 0 && (
        <div>
          <p className="mb-1.5 text-caption font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">
            Features
          </p>
          <div className="flex flex-wrap gap-1.5">
            {l.features.map((f) => (
              <span
                key={f}
                className="rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] px-2.5 py-0.5 text-caption capitalize text-[var(--color-content)]"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-caption font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">
          Bookings on this car {bookings ? `(${bookings.length})` : ''}
        </p>
        {isLoading ? (
          <Spinner size={14} />
        ) : (bookings ?? []).length === 0 ? (
          <p className="text-caption text-[var(--color-content-subtle)]">No bookings yet.</p>
        ) : (
          <div className="space-y-1.5">
            {(bookings ?? []).map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] px-3 py-2 text-caption"
              >
                <Badge tone={BOOKING_TONE[b.state] ?? 'neutral'}>{b.state}</Badge>
                <span className="tabular text-[var(--color-content-muted)]">
                  {formatDate(b.startDate)} → {formatDate(b.endDate)}
                </span>
                <span className="tabular ml-auto font-medium text-[var(--color-content)]">
                  {formatRwf(b.totalRwf)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Spec({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-[var(--color-surface-raised)] px-3 py-2">
      <dt className="text-caption text-[var(--color-content-muted)]">{label}</dt>
      <dd
        className={cn(
          'tabular font-medium capitalize',
          highlight ? 'text-[var(--color-accent-on)]' : 'text-[var(--color-content)]',
        )}
      >
        {value}
      </dd>
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
            <div
              key={b.id}
              className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-body-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[var(--color-content)]">{b.carTitle ?? b.listingId}</p>
                <p className="tabular truncate text-caption text-[var(--color-content-subtle)]">
                  {b.renterId === userId ? 'As renter' : 'As host'} · {formatDate(b.startDate)} →{' '}
                  {formatDate(b.endDate)}
                </p>
              </div>
              <span className="tabular shrink-0 text-caption text-[var(--color-content-muted)]">
                {formatRwf(b.totalRwf)}
              </span>
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
        <p className="text-body-sm text-[var(--color-content-subtle)]">No admin actions recorded.</p>
      ) : (
        <ol className="space-y-1.5 border-l-2 border-[var(--color-line)] pl-3 text-caption">
          {(data ?? []).map((a: AdminAction) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium text-[var(--color-content)]">
                {ACTION_LABEL[a.action] ?? a.action}
              </span>
              {a.detail && <span className="text-[var(--color-content-muted)]">— {a.detail}</span>}
              {a.adminName && <span className="text-[var(--color-content-subtle)]">by {a.adminName}</span>}
              <span className="tabular ml-auto text-[var(--color-content-subtle)]">{timeAgo(a.createdAt)}</span>
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
      <dt className="text-caption text-[var(--color-content-muted)]">{label}</dt>
      <dd className="tabular font-medium text-[var(--color-content)]">{value}</dd>
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
        active ? 'border-[var(--color-warn-500)] bg-[var(--color-warn-tint)]' : 'border-[var(--color-line)]',
      )}
    >
      <CardBody className="flex items-center gap-4">
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors',
            active
              ? 'bg-[var(--color-warn-500)]/20 text-[var(--color-warn-500)]'
              : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
          )}
        >
          {active ? <Zap size={24} /> : <ShieldCheck size={24} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-body font-semibold text-[var(--color-content)]">Auto-approve KYC</p>
            <span
              className={cn(
                'rounded-[var(--radius-pill)] px-2 py-0.5 text-caption font-bold uppercase tracking-wide',
                active
                  ? 'bg-[var(--color-warn-500)] text-white'
                  : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
              )}
            >
              {active ? 'On' : 'Off'}
            </span>
          </div>
          <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
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
            'relative h-8 w-14 shrink-0 rounded-[var(--radius-pill)] transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            active
              ? 'bg-[var(--color-warn-500)]'
              : 'bg-[var(--color-line-strong)] focus-visible:ring-[var(--color-line-strong)]',
            busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
          )}
        >
          <span
            className={cn(
              'absolute top-1 grid h-6 w-6 place-items-center rounded-[var(--radius-pill)] bg-white shadow-[var(--shadow-float)] transition-transform duration-200',
              active ? 'translate-x-7' : 'translate-x-1',
            )}
          >
            {active ? (
              <Zap size={12} className="text-[var(--color-warn-500)]" />
            ) : (
              <ShieldCheck size={12} className="text-[var(--color-content-subtle)]" />
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
        <div className="flex gap-1.5">
          {SCOPE_FILTERS.map((s) => (
            <Chip
              key={s.key}
              selected={scope === s.key}
              onClick={() => {
                setScope(s.key);
                setPage(0);
              }}
            >
              {s.label}
            </Chip>
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
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="pl-9"
          />
        </form>
      </div>

      {query.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <PersonRowSkeleton key={i} />
          ))}
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
          <p className="truncate font-medium text-[var(--color-content)]">{person.fullName}</p>
          <p className="truncate text-caption text-[var(--color-content-subtle)]">{person.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {person.pendingCount > 0 && (
            <Badge tone="warn" className="tabular">
              {person.pendingCount} to review
            </Badge>
          )}
          <Badge tone={meta.tone}>
            {person.verification}
            {person.verificationOverride ? ' (override)' : ''}
          </Badge>
          {open ? (
            <ChevronUp size={16} className="text-[var(--color-content-subtle)]" />
          ) : (
            <ChevronDown size={16} className="text-[var(--color-content-subtle)]" />
          )}
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
    onSuccess: () => {
      invalidateKyc(queryClient);
      void relayVerificationToPayhold(person.id);
    },
  });
  const clearOverride = useMutation({
    mutationFn: () => client.clearVerificationOverride(person.id),
    // Clearing hands the status back to the documents, which may change it.
    onSuccess: () => {
      invalidateKyc(queryClient);
      void relayVerificationToPayhold(person.id);
    },
  });

  return (
    <div className="space-y-3 border-t border-[var(--color-line)] px-4 py-3">
      {isLoading ? (
        <Spinner size={18} />
      ) : (
        (docs ?? []).map((d) => <DocumentRow key={d.id} doc={d} />)
      )}

      <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
        <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
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
        <p className="mt-2 text-caption text-[var(--color-content-subtle)]">
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
    onSuccess: (_row, v) => {
      invalidateKyc(queryClient);
      setRejecting(false);
      setNote('');
      // Approving one document only verifies the person once every required
      // one is approved; until then PayHold is told "not verified", quietly.
      void relayVerificationToPayhold(doc.profileId, {
        quietUnlessVerified: v.status === 'verified',
      });
    },
  });

  async function openDocument() {
    if (!doc.storagePath) return;
    const url = await client.getKycDocumentUrl(doc.storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const meta = STATUS_META[doc.status];

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-body-sm font-medium text-[var(--color-content)]">
          {DOC_TYPE_LABEL[doc.type] ?? doc.type}
        </span>
        <Badge tone={meta.tone}>{doc.status}</Badge>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 text-body-sm">
        <span className="flex min-w-0 items-center gap-2 text-[var(--color-content-muted)]">
          <ShieldCheck size={15} className="shrink-0 text-[var(--color-content-subtle)]" />
          <span className="truncate">{doc.fileName ?? 'Document'}</span>
        </span>
        {doc.storagePath ? (
          <button
            type="button"
            onClick={openDocument}
            className="inline-flex shrink-0 items-center gap-1 text-[var(--color-accent-on)] hover:underline"
          >
            View <ExternalLink size={13} />
          </button>
        ) : (
          <span className="shrink-0 text-caption text-[var(--color-content-subtle)]">No file (legacy)</span>
        )}
      </div>

      <p className="tabular mt-1.5 text-caption text-[var(--color-content-subtle)]">
        {doc.uploadedAt && <>Uploaded {timeAgo(doc.uploadedAt)}</>}
        {doc.reviewedAt && <> · Reviewed {timeAgo(doc.reviewedAt)}</>}
      </p>

      {doc.status === 'rejected' && doc.note && (
        <p className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-3 py-2 text-body-sm text-[var(--color-danger-500)]">
          {doc.note}
        </p>
      )}

      {rejecting ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Reason shown to the applicant (e.g. photo is blurry)…"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] focus:outline-none"
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
    return <ActivitySkeleton />;
  }
  if (!data || data.items.length === 0) {
    return <Empty text="No KYC activity yet." />;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="divide-y divide-[var(--color-line)] p-0">
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

/** Matches `ActivityRow` — a dot, two text lines and a trailing timestamp,
    inside the same divided Card the loaded feed uses. */
function ActivitySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Card>
        <CardBody className="divide-y divide-[var(--color-line)] p-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function ActivityRow({ event }: { event: VerificationEvent }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-body-sm">
      <EventDot kind={event.event} />
      <div className="min-w-0 flex-1">
        <p className="text-[var(--color-content)]">
          <span className="font-medium">{event.owner?.fullName ?? event.profileId}</span>
          <span className="text-[var(--color-content-muted)]">
            {' · '}
            {event.docType ? DOC_TYPE_LABEL[event.docType] ?? event.docType : 'Overall status'}
          </span>
        </p>
        <p className="text-caption text-[var(--color-content-subtle)]">
          {EVENT_LABEL[event.event]}
          {event.actorName ? ` by ${event.actorName}` : ''}
          {event.note ? ` — “${event.note}”` : ''}
        </p>
      </div>
      <span className="tabular shrink-0 text-caption text-[var(--color-content-subtle)]">
        {timeAgo(event.createdAt)}
      </span>
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

/** Timeline dot per event kind — a state indicator, so it borrows the same
    semantic tokens as everywhere else rather than raw Tailwind swatches.
    `override` gets the inverse fill (like a selected Chip) to read as "an
    admin did this" without introducing another hue. */
const EVENT_TONE: Record<VerificationEventKind, string> = {
  submitted: 'bg-[var(--color-warn-500)]',
  resubmitted: 'bg-[var(--color-warn-500)]',
  approved: 'bg-[var(--color-accent-on)]',
  rejected: 'bg-[var(--color-danger-500)]',
  override: 'bg-[var(--color-surface-inverse)]',
  updated: 'bg-[var(--color-line-strong)]',
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
    <div className="flex items-center justify-between text-body-sm text-[var(--color-content-muted)]">
      <span className="tabular">
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
    return <CardListSkeleton />;
  }
  return <>{children}</>;
}

/** Generic placeholder for a moderation/dispute list — `FlagCard` and
    `DisputeCard` share this shape: a header line + badge, two body lines,
    and a row of action-sized buttons. */
function CardListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex items-center gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="ml-auto h-5 w-20 rounded-[var(--radius-pill)]" />
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-1/3" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card>
      <CardBody className="py-12 text-center text-body-sm text-[var(--color-content-muted)]">{text}</CardBody>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-caption text-[var(--color-content-muted)]">{label}</p>
          <p className="tabular truncate font-semibold text-[var(--color-content)]">{value}</p>
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
        <span className="text-[var(--color-content-subtle)]">
          {flag.targetType === 'listing' ? <Car size={16} /> : <User size={16} />}
        </span>
        <span className="flex-1 truncate font-medium text-[var(--color-content)]">{flag.targetLabel}</span>
        <Badge tone="danger">{FLAG_REASON_LABEL[flag.reason]}</Badge>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-body-sm text-[var(--color-content-muted)]">{flag.detail}</p>
        <p className="tabular text-caption text-[var(--color-content-subtle)]">
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
        <span className="tabular font-medium text-[var(--color-content)]">
          {formatRwf(dispute.amountRwf)} claim
        </span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-body-sm text-[var(--color-content-muted)]">{dispute.reason}</p>
        <p className="tabular text-caption text-[var(--color-content-subtle)]">
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
