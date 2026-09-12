import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PayoutSetupModal } from '@/pages/PayoutSetupPage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Car,
  CheckCircle2,
  Circle,
  ExternalLink,
  Inbox,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Navigation,
  Pencil,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  Star,
  Undo2,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Booking, Host, Listing, Payout } from '@autohire/shared';
import { client } from '@/lib/client';
import { useMatchMedia } from '@/lib/useVisualViewport';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { bookingCurrency, formatAmount, formatTotals, sumByCurrency } from '@/lib/money';
import { formatMoney } from '@/lib/currency';
import { listingHeadlinePrice } from '@/lib/pricing';
import { PAYMENTS_PAYHOLD } from '@/lib/payments';
import { PAYOUT_CHANNEL_LABEL, PAYOUT_STATUS_META } from '@/lib/payouts';
import { hostTripHint } from '@/lib/trips';
import { TripCard } from '@/components/TripCard';
import { Img } from '@/components/Img';
import { RequesterModal } from '@/components/RequesterModal';
import { HostBroadcastComposer } from '@/components/HostBroadcastComposer';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Chip,
  ConfirmDialog,
  Input,
  ListGroup,
  Notice,
  Skeleton,
  Spinner,
  toast,
} from '@/components/ui';

type View = 'cars' | 'payouts';
type CarTab = 'requests' | 'trips' | 'manage';
/** Quick filters for the car rail, wired to the clickable stat bar. */
type CarFilter = 'all' | 'requests' | 'trip' | 'overdue';

/** One item in the cross-fleet "Action needed" queue. */
type ActionItem =
  | { kind: 'request'; booking: Booking }
  | { kind: 'pickup'; booking: Booking }
  | { kind: 'return'; booking: Booking; overdue: boolean };

const LIVE_STATES: Booking['state'][] = ['confirmed', 'pickup', 'active', 'return'];
const ACTIVE_STATES: Booking['state'][] = ['pickup', 'active', 'return'];
const CLOSED_STATES: Booking['state'][] = ['completed', 'cancelled', 'declined'];

const todayISO = () => new Date().toISOString().slice(0, 10);

/** A booking that still needs attention — not completed, cancelled or declined. */
const isOpen = (b: Booking) => !CLOSED_STATES.includes(b.state);

/** A live trip whose return date has already passed. */
const isOverdue = (b: Booking) => LIVE_STATES.includes(b.state) && b.endDate < todayISO();

/** Counts + host earnings for a set of bookings (host keeps the subtotal). */
/**
 * The car's own headline rate, in its own currency (never hardcoded RWF — a
 * car in Dubai or Shanghai is priced in AED/CNY, not RWF). A car is priced by
 * the day OR the hour, never both, so this shows exactly one.
 */
function listingPriceLabel(listing: Listing): string {
  const { amount, unit } = listingHeadlinePrice(listing);
  return `${formatMoney(amount, listing.priceCurrency)}/${unit}`;
}

/** `currencyOf` says which currency each booking's amounts are in — a host
    with cars in two markets earns in two currencies, kept apart. */
function bookingStats(bookings: Booking[], currencyOf: (b: Booking) => string = (b) => bookingCurrency(b)) {
  const completed = bookings.filter((b) => b.state === 'completed');
  return {
    pending: bookings.filter((b) => b.state === 'requested').length,
    upcoming: bookings.filter((b) => b.state === 'confirmed').length,
    active: bookings.filter((b) => ACTIVE_STATES.includes(b.state)).length,
    completed: completed.length,
    earned: sumByCurrency(completed.map((b) => ({ amount: b.subtotalRwf, currency: currencyOf(b) }))),
  };
}

/** Available / Booked now / In maintenance for a car, derived from its trips. */
function carStatusBadge(listing: Listing, bookings: Booking[]) {
  const today = new Date().toISOString().slice(0, 10);
  if (listing.status === 'maintenance') {
    return {
      tone: 'warning' as const,
      label: `Maintenance${listing.maintenanceUntil ? ` · back ${formatDate(listing.maintenanceUntil)}` : ''}`,
    };
  }
  const bookedNow = bookings.some(
    (b) => LIVE_STATES.includes(b.state) && b.startDate <= today && b.endDate > today,
  );
  if (bookedNow) return { tone: 'accent' as const, label: 'Booked now' };
  return { tone: 'success' as const, label: 'Available' };
}

/**
 * How urgently a car needs the host's attention, so the rail floats the cars
 * with overdue returns and pending requests to the top. Higher = more urgent.
 */
function attentionRank(bookings: Booking[]) {
  const s = bookingStats(bookings);
  return (
    (bookings.some(isOverdue) ? 1000 : 0) + s.pending * 100 + s.active * 10
  );
}

/** Does a car match the active quick-filter from the stat bar? */
function matchesFilter(filter: CarFilter, bookings: Booking[]) {
  const s = bookingStats(bookings);
  switch (filter) {
    case 'requests':
      return s.pending > 0;
    case 'trip':
      return s.active > 0;
    case 'overdue':
      return bookings.some(isOverdue);
    default:
      return true;
  }
}

/**
 * Host / company dashboard — a master–detail "car inbox". The left rail lists
 * every vehicle with its pending-request count and status; the right pane is the
 * selected car's Requests / Trips / Manage, so a fleet host acts on each car in
 * one place instead of tab-hopping across global lists.
 */
export function DashboardPage() {
  const [view, setView] = useState<View>('cars');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CarFilter>('all');

  const hostQuery = useQuery({ queryKey: ['ownerHost'], queryFn: () => client.getCurrentHost() });
  const listingsQuery = useQuery({
    queryKey: ['ownerListings'],
    queryFn: () => client.listOwnerListings(),
  });
  const bookingsQuery = useQuery({
    queryKey: ['ownerBookings'],
    queryFn: () => client.listOwnerBookings(),
  });
  const payoutsQuery = useQuery({
    queryKey: ['ownerPayouts'],
    queryFn: () => client.listOwnerPayouts(),
  });

  const host = hostQuery.data;
  const listings = useMemo(() => listingsQuery.data ?? [], [listingsQuery.data]);
  const bookings = useMemo(() => bookingsQuery.data ?? [], [bookingsQuery.data]);
  const payouts = payoutsQuery.data ?? [];

  // Per-car booking buckets.
  const bookingsByCar = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const list = map.get(b.listingId) ?? [];
      list.push(b);
      map.set(b.listingId, list);
    }
    return map;
  }, [bookings]);

  // Amounts are in each car's own currency (see `bookingCurrency`); a payout
  // is in its booking's. RWF is only the fallback for a host with no cars yet.
  const currencyOfBooking = (b: Booking) =>
    bookingCurrency(b, listings.find((l) => l.id === b.listingId));
  const currencyOfPayout = (p: Payout) => {
    const b = bookings.find((x) => x.id === p.bookingId);
    return b ? currencyOfBooking(b) : (listings[0]?.priceCurrency ?? 'RWF');
  };
  const fallbackCurrency = listings[0]?.priceCurrency ?? 'RWF';

  const stats = bookingStats(bookings, currencyOfBooking);
  const overdueTotal = bookings.filter(isOverdue).length;
  const scheduledTotals = sumByCurrency(
    payouts
      .filter((p) => p.status !== 'paid')
      .map((p) => ({ amount: p.amountRwf, currency: currencyOfPayout(p) })),
  );

  // Real secondary indicators for the stat cards — all derived from live data,
  // no fabricated deltas (we don't store historical snapshots to trend against).
  const indicators = useMemo(() => {
    const today = todayISO();
    const dayMs = 86_400_000;
    const weekAgo = new Date(Date.now() - 7 * dayMs).toISOString().slice(0, 10);
    const soonCutoff = new Date(Date.now() + 2 * dayMs).toISOString().slice(0, 10);

    const available = listings.filter((l) => {
      if (l.status === 'maintenance') return false;
      const cb = bookingsByCar.get(l.id) ?? [];
      return !cb.some((b) => LIVE_STATES.includes(b.state) && b.startDate <= today && b.endDate > today);
    }).length;

    const newRequests = bookings.filter(
      (b) => b.state === 'requested' && b.createdAt.slice(0, 10) >= weekAgo,
    ).length;

    const dueSoon = bookings.filter(
      (b) => ACTIVE_STATES.includes(b.state) && b.endDate >= today && b.endDate <= soonCutoff,
    ).length;

    const nextPayoutDate = payouts
      .filter((p) => p.status !== 'paid' && p.scheduledFor)
      .map((p) => p.scheduledFor)
      .sort()[0];
    const nextPayoutDays = nextPayoutDate
      ? Math.max(0, Math.round((new Date(nextPayoutDate).getTime() - Date.now()) / dayMs))
      : null;

    return { available, newRequests, dueSoon, nextPayoutDays };
  }, [listings, bookings, bookingsByCar, payouts]);

  // Cross-fleet action queue: requests to answer + handoffs the host owns.
  const listingsById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const actionItems = useMemo<ActionItem[]>(() => {
    const today = todayISO();
    const items: ActionItem[] = [];
    for (const b of bookings) {
      if (b.state === 'requested') items.push({ kind: 'request', booking: b });
      else if ((b.state === 'confirmed' || b.state === 'pickup') && !b.pickupHostAt)
        items.push({ kind: 'pickup', booking: b });
      else if (
        (b.state === 'active' || b.state === 'return') &&
        !b.returnHostAt &&
        (b.state === 'return' || b.endDate < today)
      )
        items.push({ kind: 'return', booking: b, overdue: b.endDate < today });
    }
    const weight = (i: ActionItem) =>
      i.kind === 'return' && i.overdue ? 0 : i.kind === 'request' ? 1 : i.kind === 'pickup' ? 2 : 3;
    return items.sort((a, b) => weight(a) - weight(b));
  }, [bookings]);

  // On load, create any pending overdue-return notifications for my trips.
  const queryClient = useQueryClient();
  useEffect(() => {
    client.checkOverdueReturns().then(
      () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      () => {},
    );
  }, [queryClient]);

  // Apply search + quick-filter, then float cars that need attention to the top.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings
      .filter((l) => {
        const cb = bookingsByCar.get(l.id) ?? [];
        if (!matchesFilter(filter, cb)) return false;
        if (!q) return true;
        return (
          l.title.toLowerCase().includes(q) ||
          l.location.toLowerCase().includes(q) ||
          `${l.make} ${l.model}`.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          attentionRank(bookingsByCar.get(b.id) ?? []) -
          attentionRank(bookingsByCar.get(a.id) ?? []),
      );
  }, [listings, bookingsByCar, search, filter]);

  // Jump from a stat tile to the matching cars: switch to the fleet view, set the
  // quick-filter, and below the two-pane breakpoint drop back to the list so the
  // result is visible. Mirrors the `lg:` split in the JSX below — a tablet in
  // portrait is too narrow for a 320px rail + detail pane, so it stays single-pane
  // alongside phones and only real desktop/landscape-tablet widths split.
  // Read reactively, not once at mount. The auto-select below used to test
  // `window.matchMedia` inside an effect that ran a single time, so a window
  // that was wide when the fleet loaded and narrow afterwards — a rotation, a
  // resize, a phone-width frame that laid out wide for one paint — left a car
  // selected with no list behind it. A host then landed inside one vehicle and
  // had to find "back" to reach their own fleet, which is the wrong first
  // screen and was reported as exactly that.
  const twoPane = useMatchMedia('(min-width: 1024px)');

  const focusFilter = (next: CarFilter) => {
    setView('cars');
    setFilter(next);
    if (!twoPane) setSelectedId(null);
  };

  // Auto-select the first car only where there is room to show it beside the
  // list. Narrow means the list IS the screen, so nothing is selected until
  // the host taps a car — and dropping below the breakpoint returns them to
  // the list rather than stranding them in a detail pane.
  // Two effects, deliberately, because they answer different questions and
  // merging them broke the screen: a single effect that cleared the selection
  // whenever `!twoPane` re-ran on every change of `selectedId`, so tapping a
  // car set it and the effect wiped it on the very next render. The detail
  // pane could not be opened on a phone at all.
  //
  // Leaving the two-pane width returns to the list — once, on the transition.
  useEffect(() => {
    if (!twoPane) setSelectedId(null);
  }, [twoPane]);

  // And where there is room for a detail pane, open the first car so the right
  // half is never an empty panel.
  useEffect(() => {
    if (!twoPane || selectedId || listings.length === 0) return;
    setSelectedId(listings[0].id);
  }, [listings, selectedId, twoPane]);

  const selected = listings.find((l) => l.id === selectedId) ?? null;

  // Quick-filter tile content, built once and reused at two sizes: full-size
  // for the two things a host must decide on right now, and again (once
  // full-size, once dense) for the four that report status rather than ask
  // for a decision. Keeping the numbers here, not inline twice, is what keeps
  // the phone and desktop layouts from drifting apart.
  const vehiclesStat = {
    icon: Car,
    label: 'Vehicles',
    value: `${listings.length}`,
    note: listings.length ? `${indicators.available} available` : undefined,
    onClick: () => focusFilter('all'),
    active: view === 'cars' && filter === 'all',
  };
  const requestsStat = {
    icon: Inbox,
    label: 'Requests',
    value: `${stats.pending}`,
    note: indicators.newRequests
      ? `${indicators.newRequests} new this week`
      : stats.pending
        ? 'Awaiting your reply'
        : 'All caught up',
    noteTone: (stats.pending ? 'info' : 'muted') as NoteTone,
    onClick: () => focusFilter('requests'),
    active: view === 'cars' && filter === 'requests',
  };
  const tripStat = {
    icon: Navigation,
    label: 'On trip',
    value: `${stats.active}`,
    note: indicators.dueSoon
      ? `${indicators.dueSoon} due back soon`
      : stats.active
        ? 'All on schedule'
        : 'None active',
    noteTone: (indicators.dueSoon ? 'warn' : 'muted') as NoteTone,
    onClick: () => focusFilter('trip'),
    active: view === 'cars' && filter === 'trip',
  };
  const overdueStat = {
    icon: AlertTriangle,
    label: 'Overdue',
    value: `${overdueTotal}`,
    note: overdueTotal ? 'Needs action' : 'All returned on time',
    noteTone: (overdueTotal ? 'danger' : 'muted') as NoteTone,
    onClick: () => focusFilter('overdue'),
    active: view === 'cars' && filter === 'overdue',
  };
  const earnedStat = {
    icon: Banknote,
    label: 'Earned',
    value: formatTotals(stats.earned, fallbackCurrency),
    note: `${stats.completed} completed trip${stats.completed === 1 ? '' : 's'}`,
  };
  const payoutsStat = {
    icon: Wallet,
    label: 'Payouts due',
    value: formatTotals(scheduledTotals, fallbackCurrency),
    note: scheduledTotals.some((t) => t.amount > 0)
      ? indicators.nextPayoutDays != null
        ? `Next in ${indicators.nextPayoutDays}d`
        : 'Scheduled'
      : 'Nothing scheduled',
    onClick: () => setView('payouts'),
    active: view === 'payouts',
  };

  return (
    <section className="mx-auto max-w-[1500px] px-4 py-6 sm:py-8">
      {/* Header — plain surface. The only accent on this screen's chrome is
          the "Add a listing" button itself; a tinted band behind it would be
          a large surface wearing the brand hue for no reason. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
            <LayoutDashboard size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="text-h2 text-[var(--color-content)]">Host dashboard</h1>
            <p className="mt-0.5 truncate text-body-sm text-[var(--color-content-muted)]">
              {host ? host.businessName ?? host.fullName : 'Loading…'}
            </p>
          </div>
        </div>
        <Link to="/cars/new">
          <Button>
            <Plus size={16} /> Add a listing
          </Button>
        </Link>
      </div>

      {host && <ReconnectPayouts host={host} />}
      {host && <SetupChecklist host={host} listingCount={listings.length} />}
      {host && <HostBroadcastComposer />}

      {/* Quick-filter tiles — counts a host scans and taps, not a wall of big
          numbers. Weight and a state chip carry the signal; no per-metric hue.

          On a phone, six equal-weight tiles read as a wall of digits, so only
          the two a host must actually decide on — new requests, overdue
          returns — run full size up top. The rest (fleet size, what's on the
          road, money) are things a host checks, not acts on, so they follow
          in one dense row underneath. From `sm` up there's room for all six
          at one weight, so the two phone-only rows hand off to a single grid. */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:hidden">
        <StatCard {...requestsStat} />
        <StatCard {...overdueStat} />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:hidden">
        <StatCard {...vehiclesStat} compact />
        <StatCard {...tripStat} compact />
        <StatCard {...earnedStat} compact />
        <StatCard {...payoutsStat} compact />
      </div>

      <div className="mt-5 hidden gap-2 sm:grid sm:grid-cols-3 lg:grid-cols-6">
        <StatCard {...vehiclesStat} />
        <StatCard {...requestsStat} />
        <StatCard {...tripStat} />
        <StatCard {...overdueStat} />
        <StatCard {...earnedStat} />
        <StatCard {...payoutsStat} />
      </div>

      {/* View toggle — segmented Chip pair, same control as the Trips filter. */}
      <div className="mt-6 flex gap-2">
        {(['cars', 'payouts'] as View[]).map((v) => (
          <Chip key={v} selected={view === v} onClick={() => setView(v)}>
            {v === 'cars' ? 'Fleet' : 'Payouts'}
          </Chip>
        ))}
      </div>

      {view === 'cars' && !listingsQuery.isLoading && listings.length > 0 && actionItems.length > 0 && (
        <ActionQueue items={actionItems} listingsById={listingsById} />
      )}

      {view === 'payouts' ? (
        <div className="mt-6">
          {payoutsQuery.isLoading ? (
            <PayoutsSkeleton />
          ) : payoutsQuery.isError ? (
            <ErrorState onRetry={() => payoutsQuery.refetch()} />
          ) : (
            <PayoutsView payouts={payouts} currencyOf={currencyOfPayout} fallbackCurrency={fallbackCurrency} />
          )}
        </div>
      ) : listingsQuery.isError || bookingsQuery.isError ? (
        <ErrorState
          onRetry={() => {
            listingsQuery.refetch();
            bookingsQuery.refetch();
          }}
        />
      ) : listingsQuery.isLoading ? (
        <FleetSkeleton />
      ) : listings.length === 0 ? (
        <EmptyFleet />
      ) : (
        <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
          {/* Car list — sticks in place on desktop so it stays reachable while
              the detail pane on the right scrolls (mirrors the home page's
              category sidebar). Splits into two panes at `lg` (1024px) rather
              than `md` (768px) — a tablet in portrait is too narrow for a
              320px rail plus a detail pane, so it gets the same full-width
              single-pane view as a phone. */}
          <aside
            className={cn(
              selected && 'hidden lg:block',
              // `min-w-0`: a grid item sizes to `min-width: auto` by default, so
              // one long car title widened this track to 517px inside a 388px
              // phone and the row was clipped — the price scrolled out of sight
              // entirely with no scrollbar to say so.
              'min-w-0 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)] lg:flex-col',
            )}
          >
            {/* The search bar stays visible while the list scrolls, at every
                screen size — not just desktop — same sticky-under-the-header
                treatment as the app header itself. */}
            <div className="sticky top-16 z-10 bg-[var(--color-surface-sunken)]/95 pb-3 pt-1 backdrop-blur lg:static lg:z-auto lg:shrink-0 lg:bg-transparent lg:py-0 lg:backdrop-blur-none">
              <div className="relative mb-3">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
                />
                <Input
                  placeholder="Search your listings"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Active-filter indicator — the stat bar above is the filter control;
                  this just shows what's applied and offers a one-tap clear. */}
              {filter !== 'all' && (
                <div className="mb-3 flex items-center justify-between rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-1.5 text-caption">
                  <span className="font-medium text-[var(--color-content-muted)]">
                    Showing{' '}
                    {filter === 'requests' ? 'cars with requests' : filter === 'trip' ? 'cars on a trip' : 'overdue cars'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className="inline-flex items-center gap-1 font-medium text-[var(--color-accent-on)] hover:underline"
                  >
                    <X size={12} /> Clear
                  </button>
                </div>
              )}
            </div>

            {/* Grouped rows in one rounded container with hairline dividers,
                not a card per car — this is the same list-of-things pattern as
                a native settings screen, just with a thumbnail per row. */}
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
              {filtered.map((l) => (
                <CarListRow
                  key={l.id}
                  listing={l}
                  bookings={bookingsByCar.get(l.id) ?? []}
                  active={l.id === selectedId}
                  onSelect={() => setSelectedId(l.id)}
                />
              ))}
              {filtered.length === 0 && (
                <li className="px-4 py-6 text-body-sm text-[var(--color-content-muted)]">
                  {filter !== 'all' ? (
                    <>
                      No cars {filter === 'requests' ? 'with pending requests' : filter === 'trip' ? 'on a trip' : 'overdue'}
                      {search && ' match your search'}.{' '}
                      <button
                        type="button"
                        onClick={() => setFilter('all')}
                        className="font-medium text-[var(--color-accent-on)] hover:underline"
                      >
                        Show all cars
                      </button>
                    </>
                  ) : (
                    <>No cars match “{search}”.</>
                  )}
                </li>
              )}
            </ul>
          </aside>

          {/* Car detail — sticks alongside the list and scrolls internally, so
              picking a different car never means re-scrolling the page to see it. */}
          <div
            className={cn(
              !selected && 'hidden lg:block',
              'min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain',
            )}
          >
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-body-sm font-medium text-[var(--color-content-muted)] hover:text-[var(--color-content)] lg:hidden"
            >
              <ArrowLeft size={16} />{' '}
              {listings.length > 0 ? `Back to your ${listings.length} cars` : 'Back to the list'}
            </button>
            {selected ? (
              <CarDetail listing={selected} bookings={bookingsByCar.get(selected.id) ?? []} />
            ) : (
              <Card>
                <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-[var(--color-content-subtle)]">
                  <Car size={26} />
                  <p className="text-body-sm">Select a listing to manage its requests and trips.</p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type NoteTone = 'muted' | 'info' | 'warn' | 'danger';

/** Secondary-line colour — a state, never the metric's own hue. */
const NOTE_COLOR: Record<NoteTone, string> = {
  muted: 'text-[var(--color-content-subtle)]',
  info: 'text-[var(--color-info-500)]',
  warn: 'text-[var(--color-warn-500)]',
  danger: 'text-[var(--color-danger-500)]',
};

/**
 * One metric as a compact tile: icon, label, big tabular value, and a live
 * secondary line. No per-metric colour — weight carries the number, and the
 * note only takes a semantic colour when it is actually reporting a state.
 * With an `onClick` it filters the fleet below.
 *
 * `compact` is the phone-only "check when you have a moment" size used for
 * the four stats that report status rather than ask for a decision — icon,
 * number and label only, four to a row, no note (there isn't room for one
 * without it truncating to nothing useful).
 */
function StatCard({
  icon: Icon,
  label,
  value,
  note,
  noteTone = 'muted',
  onClick,
  active = false,
  compact = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  noteTone?: NoteTone;
  onClick?: () => void;
  active?: boolean;
  compact?: boolean;
}) {
  if (compact) {
    const inner = (
      <>
        <Icon size={14} className="text-[var(--color-content-muted)]" />
        <p className="tabular mt-1 w-full truncate text-body-sm font-semibold leading-tight text-[var(--color-content)]">
          {value}
        </p>
        <p className="w-full truncate text-caption font-medium text-[var(--color-content-subtle)]">{label}</p>
      </>
    );
    const base =
      'flex min-w-0 flex-col items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] px-1.5 py-2.5 text-center';
    if (!onClick) {
      return <div className={base}>{inner}</div>;
    }
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label}: ${value}`}
        className={cn(
          base,
          'min-h-11 transition-colors hover:bg-[var(--color-surface-sunken)]',
          active && 'border-[var(--color-line-strong)] ring-1 ring-[var(--color-line-strong)]',
        )}
      >
        {inner}
      </button>
    );
  }

  const inner = (
    <>
      <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
        <Icon size={16} />
      </span>
      <div className="mt-3">
        <p className="text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
          {label}
        </p>
        <p className="tabular mt-0.5 truncate text-h3 leading-tight text-[var(--color-content)]">{value}</p>
        {note && (
          <p className={cn('mt-1 truncate text-caption font-medium', NOTE_COLOR[noteTone])}>{note}</p>
        )}
      </div>
    </>
  );

  const base =
    'flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-3.5 text-left';
  if (!onClick) {
    return <div className={base}>{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        base,
        'transition-colors hover:bg-[var(--color-surface-sunken)]',
        active && 'border-[var(--color-line-strong)] ring-1 ring-[var(--color-line-strong)]',
      )}
    >
      {inner}
    </button>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-control)] border px-3 py-2',
        highlight
          ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface-raised)]',
      )}
    >
      <p className="text-caption tracking-wide text-[var(--color-content-subtle)] uppercase">{label}</p>
      <p className="tabular text-body font-bold leading-tight text-[var(--color-content)]">{value}</p>
    </div>
  );
}

/** Placeholder for `PayoutsView` — the two MiniStat tiles plus a "Scheduled"
    group of row-height blocks, matching that layout so nothing jumps once
    payouts land. */
function PayoutsSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] px-3 py-2"
          >
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-1.5 h-5 w-24" />
          </div>
        ))}
      </div>
      <div>
        <Skeleton className="mb-1.5 ml-1 h-3 w-20" />
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3 first:border-t-0 sm:px-5"
            >
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-5 w-16 rounded-[var(--radius-pill)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Something went wrong loading a query — let the host retry instead of staring at zeros. */
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice tone="danger" className="mt-6 flex-col items-center py-12 text-center">
      <AlertTriangle size={20} />
      <p className="text-body-sm">Couldn't load this. Check your connection and try again.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw size={14} /> Retry
      </Button>
    </Notice>
  );
}

/** Placeholder for the master–detail layout — the same rail (search bar +
    grouped car rows) and the same detail Card shape as `CarDetail`, so
    nothing jumps once listings and bookings land. */
function FleetSkeleton() {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 border-t border-[var(--color-line)] p-3 first:border-t-0">
              <Skeleton className="h-14 w-20 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-4 w-14 shrink-0" />
                </div>
                <Skeleton className="h-5 w-20 rounded-[var(--radius-pill)]" />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Card className="hidden lg:block">
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-16 w-24 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-5 w-10" />
              </div>
            ))}
          </div>
          <div className="flex gap-4 border-b border-[var(--color-line)] pb-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function EmptyFleet() {
  const steps = [
    { icon: Car, title: 'List your car', body: 'Add photos, price and pickup location in a few minutes.' },
    { icon: MessageSquare, title: 'Get requests', body: 'Review each renter, then approve or decline from here.' },
    { icon: Banknote, title: 'Get paid', body: 'Earnings and payouts are tracked on this dashboard.' },
  ];
  return (
    <Card className="mt-6">
      <CardBody className="flex flex-col items-center gap-5 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
          <Car size={22} />
        </span>
        <div>
          <p className="text-body-lg font-semibold text-[var(--color-content)]">Start hosting in three steps</p>
          <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">Add your first vehicle to begin earning.</p>
        </div>
        <ol className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4 text-left"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-raised)] text-[var(--color-content-muted)] ring-1 ring-[var(--color-line)]">
                <s.icon size={16} />
              </span>
              <p className="mt-2 text-body-sm font-semibold text-[var(--color-content)]">
                {i + 1}. {s.title}
              </p>
              <p className="mt-0.5 text-caption text-[var(--color-content-muted)]">{s.body}</p>
            </li>
          ))}
        </ol>
        <Link to="/cars/new">
          <Button size="lg">
            <Plus size={16} /> Add a listing
          </Button>
        </Link>
      </CardBody>
    </Card>
  );
}

/** A row in the left rail: thumbnail, title, status + pending-request badge.
    Lives inside the grouped `ul` container, so it's a divided row rather
    than its own bordered card. */
function CarListRow({
  listing,
  bookings,
  active,
  onSelect,
}: {
  listing: Listing;
  bookings: Booking[];
  active: boolean;
  onSelect: () => void;
}) {
  const s = bookingStats(bookings);
  const status = carStatusBadge(listing, bookings);
  const open = bookings.filter(isOpen).length; // active trips + requests, not completed
  const overdue = bookings.some(isOverdue);
  const activity = [s.pending ? `${s.pending} request${s.pending === 1 ? '' : 's'}` : null, s.active ? `${s.active} on trip` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-3 border-t border-[var(--color-line)] p-3 text-left transition-colors first:border-t-0',
          active ? 'bg-[var(--color-surface-sunken)]' : 'hover:bg-[var(--color-surface-sunken)]',
        )}
      >
        <Img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-14 w-20 shrink-0 rounded-[var(--radius-control)] object-cover"
        />
        {/* Name and price anchor opposite ends of the row — the two things a
            host is scanning a fleet list for — rather than the price sitting
            buried in a small caption under the title where it read as one
            more meta detail instead of the number that matters. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 truncate font-medium text-[var(--color-content)]">
              {listing.title}
            </p>
            <p className="tabular shrink-0 font-semibold text-[var(--color-content)]">
              {listingPriceLabel(listing)}
            </p>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <Badge tone={status.tone}>{status.label}</Badge>
              {overdue && (
                <Badge tone="danger">
                  <AlertTriangle size={11} /> Overdue
                </Badge>
              )}
              {activity && (
                <span className="truncate text-caption text-[var(--color-content-muted)]">{activity}</span>
              )}
            </span>
            {open > 0 && (
              <span
                className="tabular flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-on)] px-1.5 text-caption font-semibold text-[var(--color-accent-contrast)]"
                title={`${open} active booking${open === 1 ? '' : 's'} (not completed)`}
              >
                {open}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/** Right pane: the selected car's header, sub-tabs and content. */
function CarDetail({ listing, bookings }: { listing: Listing; bookings: Booking[] }) {
  const [tab, setTab] = useState<CarTab>('requests');
  const status = carStatusBadge(listing, bookings);
  const s = bookingStats(bookings, (b) => bookingCurrency(b, listing));
  const overdue = bookings.filter(isOverdue);

  const requests = bookings.filter((b) => b.state === 'requested');
  const trips = bookings
    .filter((b) => b.state !== 'requested')
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

  const tabs: { key: CarTab; label: string; badge?: number }[] = [
    { key: 'requests', label: 'Requests', badge: requests.length || undefined },
    { key: 'trips', label: 'Trips', badge: trips.length || undefined },
    { key: 'manage', label: 'Manage' },
  ];

  return (
    <Card>
      <CardBody className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Img
            src={listing.photos[0]}
            alt={listing.title}
            className="h-16 w-24 shrink-0 rounded-[var(--radius-control)] object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-h4 text-[var(--color-content)]">{listing.title}</h2>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">{listing.location}</p>
            <p className="mt-0.5 flex items-center gap-2 text-body-sm text-[var(--color-content-muted)]">
              <span className="tabular font-semibold text-[var(--color-content)]">{listingPriceLabel(listing)}</span>
              <span className="inline-flex items-center gap-1 text-[var(--color-content-muted)]">
                <Star size={13} className="fill-[var(--color-warn-500)] text-[var(--color-warn-500)]" />
                {listing.ratingCount ? listing.ratingAvg?.toFixed(1) : 'New'}
              </span>
            </p>
          </div>
          <Link
            to={`/cars/${listing.id}`}
            className="inline-flex items-center gap-1 text-body-sm font-medium text-[var(--color-accent-on)] hover:underline"
          >
            <ExternalLink size={14} /> View
          </Link>
        </div>

        {overdue.length > 0 && (
          <Notice tone="danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {overdue.length === 1 ? 'A trip is' : `${overdue.length} trips are`} overdue — the car was due
              back on {overdue.map((b) => formatDate(b.endDate)).join(', ')} but isn't completed. The renter has
              been notified.
            </span>
          </Notice>
        )}

        {/* Per-car numbers */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Requests" value={`${s.pending}`} highlight={s.pending > 0} />
          <MiniStat label="Upcoming" value={`${s.upcoming}`} />
          <MiniStat label="On trip" value={`${s.active}`} />
          <MiniStat label="Earned" value={formatTotals(s.earned, listing.priceCurrency)} />
        </div>

        {/* Sub-tabs — the one place besides the primary button an active
            state is allowed to carry the accent, same rule as a selected tab
            anywhere else in the app. */}
        <div className="flex gap-1 border-b border-[var(--color-line)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-body-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-[var(--color-accent-on)] text-[var(--color-accent-on)]'
                  : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]',
              )}
            >
              {t.label}
              {t.badge !== undefined && (
                <span className="tabular rounded-full bg-[var(--color-accent-on)] px-1.5 text-caption font-semibold text-[var(--color-accent-contrast)]">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'requests' &&
          (requests.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-[var(--color-content-muted)]">
              No pending requests for this listing.
            </p>
          ) : (
            <div className="space-y-3">
              {requests.map((b) => (
                <RequestRow key={b.id} booking={b} listing={listing} />
              ))}
            </div>
          ))}

        {tab === 'trips' &&
          (trips.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-[var(--color-content-muted)]">
              No trips for this listing yet.
            </p>
          ) : (
            <div className="space-y-3">
              {trips.map((b) => (
                <TripCard key={b.id} booking={b} listing={listing} hint={hostTripHint(b)} />
              ))}
            </div>
          ))}

        {tab === 'manage' && <CarManage listing={listing} />}
      </CardBody>
    </Card>
  );
}

/** A pending request inside a car's detail: dates, total, and inline actions. */
function RequestRow({ booking, listing }: { booking: Booking; listing: Listing }) {
  const total = formatAmount(booking.totalRwf, bookingCurrency(booking, listing));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Which action the host is being asked to confirm, if any.
  const [confirm, setConfirm] = useState<'approve' | 'decline' | null>(null);

  const mutation = useMutation({
    mutationFn: (action: 'approve' | 'decline') => client.respondToBooking(booking.id, action),
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setProfileOpen(false);
      setConfirm(null);
      toast.success(action === 'approve' ? 'Request approved — the renter has been notified.' : 'Request declined.');
    },
    onError: () => toast.error("Couldn't update the request. Please try again."),
  });

  async function messageRenter() {
    setMessaging(true);
    try {
      const conv = await client.getOrCreateConversation(booking.listingId, booking.renterId, booking.hostId);
      navigate(`/messages/${conv.id}`);
    } catch {
      toast.error("Couldn't open the conversation.");
    } finally {
      setMessaging(false);
    }
  }

  // Open the confirm step; close the profile modal first so dialogs don't stack.
  const decide = (action: 'approve' | 'decline') => {
    setProfileOpen(false);
    setConfirm(action);
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="tabular text-body-sm font-medium text-[var(--color-content)]">
            {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
            <span className="font-normal text-[var(--color-content-muted)]">
              {' '}
              · {booking.days} day{booking.days === 1 ? '' : 's'}
            </span>
          </p>
          <p className="tabular mt-0.5 text-body-sm font-semibold text-[var(--color-content)]">
            {total}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Secondary, lower-weight actions — a look before deciding. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProfileOpen(true)}
            aria-label="View renter profile"
            title="View profile"
            className="px-2"
          >
            <UserRound size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={messageRenter}
            disabled={messaging}
            aria-label="Message renter"
            title="Message"
            className="px-2"
          >
            {messaging ? <Spinner size={14} /> : <MessageSquare size={16} />}
          </Button>
          <span className="mx-0.5 h-5 w-px bg-[var(--color-line-strong)]" />
          {/* The actual decision — kept as the visually heavy buttons. */}
          <Button variant="outline" size="sm" onClick={() => decide('decline')} disabled={mutation.isPending}>
            Decline
          </Button>
          <Button size="sm" onClick={() => decide('approve')} disabled={mutation.isPending}>
            Approve
          </Button>
        </div>
      </CardBody>

      <RequesterModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        renterId={booking.renterId}
        onDecide={decide}
        deciding={mutation.isPending}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'approve' ? 'Approve this request?' : 'Decline this request?'}
        tone={confirm === 'approve' ? 'primary' : 'danger'}
        confirmLabel={confirm === 'approve' ? 'Approve' : 'Decline'}
        busy={mutation.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && mutation.mutate(confirm)}
        body={
          <p>
            {confirm === 'approve' ? 'Confirm the booking for' : 'Turn down the booking for'}{' '}
            <span className="tabular font-medium text-[var(--color-content)]">
              {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
            </span>{' '}
            ({booking.days} day{booking.days === 1 ? '' : 's'} ·{' '}
            <span className="tabular font-medium text-[var(--color-content)]">{total}</span>).
            {confirm === 'approve'
              ? ' These dates will be reserved on your calendar.'
              : ' The renter will be notified and the dates stay open.'}
          </p>
        }
      />
    </Card>
  );
}

/** Per-car settings: price, maintenance, blocked dates. */
function CarManage({ listing }: { listing: Listing }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(listing.pricePerDayRwf));
  const [hourlyPrice, setHourlyPrice] = useState(String(listing.pricePerHourRwf ?? ''));
  const [newDate, setNewDate] = useState('');
  const [maintDate, setMaintDate] = useState(listing.maintenanceUntil ?? '');

  const mutation = useMutation({
    mutationFn: (
      patch: Partial<
        Pick<Listing, 'pricePerDayRwf' | 'pricePerHourRwf' | 'blockedDates' | 'status' | 'maintenanceUntil'>
      >,
    ) => client.updateListing(listing.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownerListings'] });
      queryClient.invalidateQueries({ queryKey: ['listing', listing.id] });
      toast.success('Changes saved.');
    },
    onError: () => toast.error("Couldn't save your changes. Please try again."),
  });

  const today = new Date().toISOString().slice(0, 10);
  const inMaintenance = listing.status === 'maintenance';
  const priceChanged = Number(price) !== listing.pricePerDayRwf && Number(price) > 0;
  const hourlyPriceChanged =
    Number(hourlyPrice) !== (listing.pricePerHourRwf ?? 0) && Number(hourlyPrice) > 0;

  function addBlockedDate() {
    if (!newDate || listing.blockedDates.includes(newDate)) return;
    mutation.mutate({ blockedDates: [...listing.blockedDates, newDate].sort() });
    setNewDate('');
  }

  return (
    <div className="space-y-5 pt-1">
      {/* Full details */}
      <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-[var(--color-content-muted)]">Photos, specs, location, booking mode…</p>
        <Link to={`/cars/${listing.id}/edit`} className="shrink-0">
          <Button variant="outline" size="sm">
            <Pencil size={14} /> Edit car details
          </Button>
        </Link>
      </div>

      {/* Pricing — a car is priced by the day OR the hour, never both; which
          one is fixed on the car's edit page (Pricing mode), not here. */}
      {listing.pricingMode === 'daily' ? (
        <div>
          <p className="mb-1.5 text-body-sm font-medium text-[var(--color-content)]">
            Price per day ({listing.priceCurrency})
          </p>
          <div className="flex items-center gap-2">
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="max-w-40" />
            <Button
              size="sm"
              disabled={!priceChanged || mutation.isPending}
              onClick={() => mutation.mutate({ pricePerDayRwf: Number(price) })}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-1.5 text-body-sm font-medium text-[var(--color-content)]">
            Price per hour ({listing.priceCurrency})
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={hourlyPrice}
              onChange={(e) => setHourlyPrice(e.target.value)}
              className="max-w-40"
            />
            <Button
              size="sm"
              disabled={!hourlyPriceChanged || mutation.isPending}
              onClick={() => mutation.mutate({ pricePerHourRwf: Number(hourlyPrice) })}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Maintenance */}
      <div>
        <p className="mb-1.5 text-body-sm font-medium text-[var(--color-content)]">Maintenance</p>
        {inMaintenance ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-body-sm text-[var(--color-content-muted)]">
              Off the market{listing.maintenanceUntil ? ` until ${formatDate(listing.maintenanceUntil)}` : ''}.
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ status: 'available' })}
            >
              Mark available
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-[var(--color-content-muted)]">Back in service on</span>
            <Input type="date" min={today} value={maintDate} onChange={(e) => setMaintDate(e.target.value)} className="max-w-48" />
            <Button
              variant="outline"
              size="sm"
              disabled={!maintDate || maintDate < today || mutation.isPending}
              onClick={() => mutation.mutate({ status: 'maintenance', maintenanceUntil: maintDate })}
            >
              Put in maintenance
            </Button>
          </div>
        )}
      </div>

      {/* Blocked dates */}
      <div>
        <p className="mb-1.5 text-body-sm font-medium text-[var(--color-content)]">Blocked / personal-use dates</p>
        {listing.blockedDates.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {listing.blockedDates.map((d) => (
              <span
                key={d}
                className="tabular inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-caption text-[var(--color-content-muted)]"
              >
                {formatDate(d)}
                <button
                  type="button"
                  onClick={() => mutation.mutate({ blockedDates: listing.blockedDates.filter((x) => x !== d) })}
                  className="text-[var(--color-content-subtle)] hover:text-[var(--color-content)]"
                  aria-label={`Unblock ${d}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-body-sm text-[var(--color-content-muted)]">
            No blocked dates — available throughout.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="max-w-48" />
          <Button variant="outline" size="sm" onClick={addBlockedDate} disabled={!newDate || mutation.isPending}>
            <Plus size={15} /> Block date
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The one thing a host must redo when payments move to PayHold.
 *
 * PayHold tokenizes the RAW payout number, and AutoHire only ever stored a mask
 * (`••••4242`), so there is nothing to migrate — not by fetching, not by a
 * script. Each host enters their number once more or their cars stay
 * unbookable, because a PayHold deal names a seller and they do not have one.
 *
 * Deliberately NOT part of `SetupChecklist`: that hides itself once every step
 * is done, so a host who finished onboarding months ago — exactly the host this
 * affects — would never see it.
 */
function ReconnectPayouts({ host }: { host: Host }) {
  // Reconnecting happens here, over the dashboard. This tile exists because
  // the host's cars are unbookable, so sending them to another page to fix it
  // is a detour away from the notice explaining why.
  const [open, setOpen] = useState(false);
  if (!PAYMENTS_PAYHOLD || host.payholdSellerId) return null;

  return (
    <Notice tone="warn" className="mt-5 flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Reconnect your payout account</p>
          <p className="mt-0.5 max-w-xl text-body-sm">
            We've moved to a new payments system that holds each renter's money until the trip is
            done. For your security we never stored your full account number, so please enter it
            once more. <span className="font-medium">Until you do, your cars can't be booked.</span>
          </p>
        </div>
      </div>
      <Button onClick={() => setOpen(true)}>Reconnect</Button>
      <PayoutSetupModal open={open} onClose={() => setOpen(false)} />
    </Notice>
  );
}

/**
 * New-host setup steps that unblock earning. Hides itself once all are done.
 * Verification is one of the steps, so this doubles as the verification nudge.
 */
function SetupChecklist({ host, listingCount }: { host: Host; listingCount: number }) {
  const [payoutOpen, setPayoutOpen] = useState(false);
  const verifyCta =
    host.verification === 'pending' ? 'Under review' : host.verification === 'rejected' ? 'Resubmit' : 'Verify';
  const steps = [
    { label: 'Complete your profile', done: !!host.phone, to: '/account', cta: 'Complete' },
    {
      label: 'Verify your identity',
      done: host.verification === 'verified',
      to: '/verification',
      cta: verifyCta,
      muted: host.verification === 'pending',
    },
    {
      label: 'Add a payout method',
      // On the PayHold rail the step is done once the host EXISTS as a seller.
      // `payoutStatus` only reaches 'active' when PayHold also says they can be
      // paid, which waits on verification they may not control — keying off it
      // would leave this checklist permanently unfinished for a host who did
      // everything asked of them. Whether they can actually be paid is its own
      // question, and /earnings answers it.
      done: PAYMENTS_PAYHOLD ? !!host.payholdSellerId : host.payoutStatus === 'active',
      to: '/payouts/setup',
      // Opens over the checklist instead of navigating: a host working through
      // setup steps loses their place if step two replaces the page.
      onSelect: () => setPayoutOpen(true),
      cta: 'Add payout',
    },
    {
      label: 'List your first vehicle or machine',
      done: listingCount > 0,
      to: '/cars/new',
      cta: 'Add a listing',
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Notice tone="brand" className="mt-5 flex-col items-stretch">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 font-semibold">
          <ShieldCheck size={16} />
          Finish setting up
        </h2>
        <span className="tabular text-caption font-medium">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            {s.done ? (
              <CheckCircle2 size={18} className="shrink-0" />
            ) : (
              <Circle size={18} className="shrink-0 text-[var(--color-content-subtle)]" />
            )}
            <span
              className={cn(
                'flex-1 text-body-sm',
                s.done ? 'text-[var(--color-content-subtle)] line-through' : 'text-[var(--color-content)]',
              )}
            >
              {s.label}
            </span>
            {!s.done &&
              (s.muted ? (
                <span className="text-caption font-medium text-[var(--color-content-muted)]">{s.cta}</span>
              ) : s.onSelect ? (
                <Button variant="outline" size="sm" onClick={s.onSelect}>
                  {s.cta}
                </Button>
              ) : (
                <Link to={s.to}>
                  <Button variant="outline" size="sm">
                    {s.cta}
                  </Button>
                </Link>
              ))}
          </li>
        ))}
      </ul>
      <PayoutSetupModal open={payoutOpen} onClose={() => setPayoutOpen(false)} />
    </Notice>
  );
}

/** Cross-fleet "Action needed" queue — requests to answer and handoffs to confirm. */
function ActionQueue({ items, listingsById }: { items: ActionItem[]; listingsById: Map<string, Listing> }) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<Booking | null>(null);
  const mutation = useMutation({
    mutationFn: (action: 'approve' | 'decline') => client.respondToBooking(reviewing!.id, action),
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setReviewing(null);
      toast.success(action === 'approve' ? 'Request approved — the renter has been notified.' : 'Request declined.');
    },
    onError: () => toast.error("Couldn't update the request. Please try again."),
  });

  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-body-sm font-semibold text-[var(--color-content)]">
        <AlertTriangle size={15} className="text-[var(--color-content-muted)]" />
        Action needed
        <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-surface-inverse)] px-1.5 text-caption font-semibold text-[var(--color-content-inverse)]">
          {items.length}
        </span>
      </h2>
      {/* Grouped rows, one rounded container with hairline dividers. */}
      <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]">
        {items.map((it) => (
          <ActionRow
            key={`${it.kind}-${it.booking.id}`}
            item={it}
            listing={listingsById.get(it.booking.listingId)}
            onReview={() => setReviewing(it.booking)}
          />
        ))}
      </ul>

      <RequesterModal
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        renterId={reviewing?.renterId ?? ''}
        onDecide={(action) => mutation.mutate(action)}
        deciding={mutation.isPending}
      />
    </section>
  );
}

/** One row in the action queue, with the right icon, copy and CTA per kind. */
function ActionRow({
  item,
  listing,
  onReview,
}: {
  item: ActionItem;
  listing?: Listing;
  onReview: () => void;
}) {
  const b = item.booking;
  const overdue = item.kind === 'return' && item.overdue;
  const Icon = item.kind === 'request' ? UserRound : item.kind === 'pickup' ? KeyRound : Undo2;
  const label =
    item.kind === 'request'
      ? 'New booking request'
      : item.kind === 'pickup'
        ? 'Confirm pickup'
        : overdue
          ? 'Overdue — confirm return'
          : 'Confirm return';

  return (
    <li className="flex items-center gap-3 border-t border-[var(--color-line)] px-3 py-3 transition-colors first:border-t-0 hover:bg-[var(--color-surface-sunken)]">
      <Img
        src={listing?.photos[0]}
        alt=""
        className="h-12 w-16 shrink-0 rounded-[var(--radius-control)] object-cover"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'flex items-center gap-1.5 text-body-sm font-medium',
            overdue ? 'text-[var(--color-danger-500)]' : 'text-[var(--color-content)]',
          )}
        >
          <Icon size={15} /> {label}
        </p>
        <p className="tabular truncate text-caption text-[var(--color-content-muted)]">
          {listing?.title ?? 'Car'} · {formatDate(b.startDate)} – {formatDate(b.endDate)} · {formatAmount(b.totalRwf, bookingCurrency(b, listing))}
        </p>
      </div>
      {item.kind === 'request' ? (
        <Button size="sm" onClick={onReview}>
          Review
        </Button>
      ) : (
        <Link to={`/trips/${b.id}`}>
          <Button variant="outline" size="sm">
            Open <ArrowRight size={14} />
          </Button>
        </Link>
      )}
    </li>
  );
}

function PayoutsView({
  payouts,
  currencyOf,
  fallbackCurrency,
}: {
  payouts: Payout[];
  /** A payout is in its booking's car's currency, not RWF. */
  currencyOf: (p: Payout) => string;
  fallbackCurrency: string;
}) {
  // Under PayHold these rows are a local shadow of a ledger it owns. The real
  // answer — what has cleared, what is still holding, when it lands — lives on
  // /earnings, so point there rather than letting a host trust a stale copy.
  const earningsLink = PAYMENTS_PAYHOLD ? (
    <Link
      to="/earnings"
      className="mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-3 hover:bg-[var(--color-line)]/40"
    >
      <span>
        <span className="block text-body-sm font-medium text-[var(--color-content)]">See your full earnings</span>
        <span className="block text-caption text-[var(--color-content-muted)]">
          Every trip, what stage its money is at, and when it reaches you.
        </span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-[var(--color-content-muted)]" />
    </Link>
  ) : null;

  if (payouts.length === 0) {
    return (
      <>
        {earningsLink}
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-12 text-center text-[var(--color-content-muted)]">
            <Banknote size={22} />
            <p className="text-body-sm">No payouts yet.</p>
          </CardBody>
        </Card>
      </>
    );
  }
  const due = payouts.filter((p) => p.status !== 'paid');
  const paid = payouts.filter((p) => p.status === 'paid');
  const totals = (items: Payout[]) =>
    sumByCurrency(items.map((p) => ({ amount: p.amountRwf, currency: currencyOf(p) })));
  const dueTotals = totals(due);
  const paidTotals = totals(paid);
  const nextPayout = due
    .map((p) => p.scheduledFor)
    .filter(Boolean)
    .sort()[0];

  const Group = ({ title, items }: { title: string; items: Payout[] }) =>
    items.length === 0 ? null : (
      <div>
        <p className="px-1 pb-1.5 text-caption font-medium tracking-wide text-[var(--color-content-subtle)] uppercase">
          {title}
        </p>
        <ListGroup>
          {items.map((p) => {
            const status = PAYOUT_STATUS_META[p.status];
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3 first:border-t-0 sm:px-5"
              >
                <div>
                  <p className="tabular font-medium text-[var(--color-content)]">{formatAmount(p.amountRwf, currencyOf(p))}</p>
                  <p className="text-body-sm text-[var(--color-content-muted)]">
                    {PAYOUT_CHANNEL_LABEL[p.channel]} ·{' '}
                    {p.paidAt ? `Paid ${formatDate(p.paidAt)}` : `Due ${formatDate(p.scheduledFor)}`}
                  </p>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
            );
          })}
        </ListGroup>
      </div>
    );

  return (
    <div className="space-y-5">
      {earningsLink}
      <div className="grid grid-cols-2 gap-3">
        <MiniStat
          label="Due"
          value={formatTotals(dueTotals, fallbackCurrency)}
          highlight={dueTotals.some((t) => t.amount > 0)}
        />
        <MiniStat label="Paid out" value={formatTotals(paidTotals, fallbackCurrency)} />
      </div>
      {nextPayout && (
        <p className="flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)]">
          <Banknote size={15} className="text-[var(--color-content-muted)]" /> Next payout{' '}
          <span className="tabular">{formatDate(nextPayout)}</span>.
        </p>
      )}
      <Group title="Scheduled" items={due} />
      <Group title="Paid" items={paid} />
    </div>
  );
}
