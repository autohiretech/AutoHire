import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
  Send,
  Trash2,
  User,
} from 'lucide-react';
import type {
  AdminAction,
  AdminUser,
  Flag as FlagType,
  Listing,
  VerificationEvent,
  VerificationEventKind,
  VerificationStatus,
} from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/cn';
import { formatDate, timeAgo } from '@/lib/format';
import { listingHeadlinePrice } from '@/lib/pricing';
import { bookingCurrency, formatAmount } from '@/lib/money';
import { DOC_TYPE_LABEL, FLAG_REASON_LABEL, MODERATION_STATUS_META } from '@/lib/admin';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Skeleton, Spinner } from '@/components/ui';
import { PhotoCarousel } from '@/components/PhotoCarousel';
import { Navigate, useLocation } from 'react-router-dom';
import { sectionForPath } from '@/components/admin/AdminSidebar';
import { DisputesSection } from '@/components/admin/DisputesSection';
import { NotificationsSection } from '@/components/admin/NotificationsSection';
import { KycReviewSection, PersonVerification } from '@/components/admin/KycReviewSection';
import { OverviewSection } from '@/components/admin/OverviewSection';

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
  const hostsQuery = useQuery({ queryKey: ['hosts'], queryFn: () => client.listHosts() });

  const flags = flagsQuery.data ?? [];
  const hostsById = new Map((hostsQuery.data ?? []).map((h) => [h.id, h]));

  function nameOf(id: string): string {
    if (id === me?.id) return me.fullName;
    const h = hostsById.get(id);
    return h?.businessName ?? h?.fullName ?? id;
  }

  if (!section) return <Navigate to="/" replace />;
  const tab = section.key;

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-h2 text-[var(--color-content)]">{section.label}</h1>
      <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">{section.description}</p>

      <div className="mt-6">
        {tab === 'overview' && <OverviewSection />}
        {tab === 'users' && <UsersTab />}
        {tab === 'verification' && <KycReviewSection />}
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
        {tab === 'disputes' && <DisputesSection nameOf={nameOf} />}
        {tab === 'notifications' && <NotificationsSection />}
      </div>
    </section>
  );
}

/** Placeholder for the Overview tab — the two `Stat` tile grids (Marketplace,
    KYC verification) plus the electric-fleet card, sized to match so nothing
    jumps once `adminStats`/`kycMetrics` land. */
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

          <div>
            <SectionTitle>Verification &amp; documents</SectionTitle>
            <PersonVerification person={user} />
          </div>
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
  const price = `${formatAmount(headline.amount, l.priceCurrency)}/${headline.unit}`;
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
                  {formatAmount(b.totalRwf, bookingCurrency(b, l))}
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
                {formatAmount(b.totalRwf, bookingCurrency(b))}
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
const PAGE_SIZE = 20;

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
