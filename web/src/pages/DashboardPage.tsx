import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Car,
  CheckCircle2,
  ChevronLeft,
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
  TrendingUp,
  Undo2,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Booking, Host, Listing, Payout } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { formatMoney } from '@/lib/currency';
import { PAYMENTS_PAYHOLD } from '@/lib/payments';
import { PAYOUT_CHANNEL_LABEL, PAYOUT_STATUS_META } from '@/lib/payouts';
import { hostTripHint } from '@/lib/trips';
import { TripCard } from '@/components/TripCard';
import { Img } from '@/components/Img';
import { RequesterModal } from '@/components/RequesterModal';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Input,
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
 * The day rate, in the listing's own currency (never hardcoded RWF — a car
 * in Dubai or Shanghai is priced in AED/CNY, not RWF). Adds the hourly rate
 * alongside when the host has opted the car into hourly booking.
 */
function listingPriceLabel(listing: Listing): string {
  const day = `${formatMoney(listing.pricePerDayRwf, listing.priceCurrency)}/day`;
  if (!listing.hourlyBookingEnabled || listing.pricePerHourRwf == null) return day;
  return `${day} · ${formatMoney(listing.pricePerHourRwf, listing.priceCurrency)}/hr`;
}

function bookingStats(bookings: Booking[]) {
  const completed = bookings.filter((b) => b.state === 'completed');
  return {
    pending: bookings.filter((b) => b.state === 'requested').length,
    upcoming: bookings.filter((b) => b.state === 'confirmed').length,
    active: bookings.filter((b) => ACTIVE_STATES.includes(b.state)).length,
    completed: completed.length,
    earned: completed.reduce((sum, b) => sum + b.subtotalRwf, 0),
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

  const stats = bookingStats(bookings);
  const overdueTotal = bookings.filter(isOverdue).length;
  const scheduledTotal = payouts
    .filter((p) => p.status !== 'paid')
    .reduce((sum, p) => sum + p.amountRwf, 0);

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
  const focusFilter = (next: CarFilter) => {
    setView('cars');
    setFilter(next);
    if (!window.matchMedia('(min-width: 1024px)').matches) setSelectedId(null);
  };

  // Auto-select the first car once there's room for a detail pane; below that,
  // keep the list visible until the host taps a car.
  useEffect(() => {
    if (selectedId || listings.length === 0) return;
    if (window.matchMedia('(min-width: 1024px)').matches) setSelectedId(listings[0].id);
  }, [listings, selectedId]);

  const selected = listings.find((l) => l.id === selectedId) ?? null;

  return (
    <section className="mx-auto max-w-[1500px] px-4 py-6 sm:py-8">
      {/* Header + summary — subtle brand-tinted band */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 via-white to-ink-50 px-5 py-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-brand-200/30 blur-3xl"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <LayoutDashboard size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">Host dashboard</h1>
              <p className="mt-0.5 text-sm text-ink-500">
                {host ? host.businessName ?? host.fullName : 'Loading…'}
              </p>
            </div>
          </div>
          <Link to="/cars/new">
            <Button className="shadow-sm">
              <Plus size={16} /> Add a listing
            </Button>
          </Link>
        </div>
      </div>

      {host && <ReconnectPayouts host={host} />}
      {host && <SetupChecklist host={host} listingCount={listings.length} />}

      {/* Stat cards — each metric its own card with a tinted icon chip and a live
          secondary indicator. Fleet counts filter the list; money cards are totals. */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          icon={Car}
          label="Vehicles"
          value={`${listings.length}`}
          tone="brand"
          trend={
            listings.length
              ? { label: `${indicators.available} available`, tone: indicators.available ? 'up' : 'muted' }
              : undefined
          }
          onClick={() => focusFilter('all')}
          active={view === 'cars' && filter === 'all'}
        />
        <StatCard
          icon={Inbox}
          label="Requests"
          value={`${stats.pending}`}
          tone={stats.pending ? 'info' : 'muted'}
          trend={
            indicators.newRequests
              ? { label: `${indicators.newRequests} new this week`, tone: 'up' }
              : stats.pending
                ? { label: 'Awaiting your reply', tone: 'warn' }
                : { label: 'All caught up', tone: 'muted' }
          }
          onClick={() => focusFilter('requests')}
          active={view === 'cars' && filter === 'requests'}
        />
        <StatCard
          icon={Navigation}
          label="On trip"
          value={`${stats.active}`}
          tone={stats.active ? 'amber' : 'muted'}
          trend={
            indicators.dueSoon
              ? { label: `${indicators.dueSoon} due back soon`, tone: 'warn' }
              : { label: stats.active ? 'All on schedule' : 'None active', tone: 'muted' }
          }
          onClick={() => focusFilter('trip')}
          active={view === 'cars' && filter === 'trip'}
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue"
          value={`${overdueTotal}`}
          tone={overdueTotal ? 'red' : 'muted'}
          trend={
            overdueTotal
              ? { label: 'Needs action', tone: 'danger' }
              : { label: 'All returned on time', tone: 'muted' }
          }
          onClick={() => focusFilter('overdue')}
          active={view === 'cars' && filter === 'overdue'}
        />
        <StatCard
          icon={Banknote}
          label="Earned"
          value={formatRwf(stats.earned)}
          tone="green"
          trend={{
            label: `${stats.completed} completed trip${stats.completed === 1 ? '' : 's'}`,
            tone: 'muted',
          }}
        />
        <StatCard
          icon={Wallet}
          label="Payouts due"
          value={formatRwf(scheduledTotal)}
          tone="brand"
          trend={
            scheduledTotal
              ? {
                  label: indicators.nextPayoutDays != null ? `Next in ${indicators.nextPayoutDays}d` : 'Scheduled',
                  tone: 'up',
                }
              : { label: 'Nothing scheduled', tone: 'muted' }
          }
          onClick={() => setView('payouts')}
          active={view === 'payouts'}
        />
      </div>

      {/* View toggle — segmented control */}
      <div className="mt-6 inline-flex rounded-xl bg-ink-100 p-1">
        {(['cars', 'payouts'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={cn(
              'rounded-lg px-5 py-1.5 text-sm font-medium transition-all',
              view === v ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {v === 'cars' ? 'Fleet' : 'Payouts'}
          </button>
        ))}
      </div>

      {view === 'cars' && !listingsQuery.isLoading && listings.length > 0 && actionItems.length > 0 && (
        <ActionQueue items={actionItems} listingsById={listingsById} />
      )}

      {view === 'payouts' ? (
        <div className="mt-6">
          {payoutsQuery.isLoading ? (
            <Centered />
          ) : payoutsQuery.isError ? (
            <ErrorState onRetry={() => payoutsQuery.refetch()} />
          ) : (
            <PayoutsView payouts={payouts} />
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
        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
          {/* Car list — sticks in place on desktop so it stays reachable while
              the detail pane on the right scrolls (mirrors the home page's
              category sidebar). Splits into two panes at `lg` (1024px) rather
              than `md` (768px) — a tablet in portrait is too narrow for a
              320px rail plus a detail pane, so it gets the same full-width
              single-pane view as a phone. */}
          <aside
            className={cn(
              selected && 'hidden lg:block',
              'lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)] lg:flex-col',
            )}
          >
            {/* The search bar stays visible while the list scrolls, at every
                screen size — not just desktop — same sticky-under-the-header
                treatment as the app header itself. */}
            <div className="sticky top-16 z-10 bg-ink-50/95 pb-3 pt-1 backdrop-blur lg:static lg:z-auto lg:shrink-0 lg:bg-transparent lg:py-0 lg:backdrop-blur-none">
              <div className="relative mb-3">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
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
                <div className="mb-3 flex items-center justify-between rounded-lg bg-ink-100 px-3 py-1.5 text-xs">
                  <span className="font-medium text-ink-600">
                    Showing{' '}
                    {filter === 'requests' ? 'cars with requests' : filter === 'trip' ? 'cars on a trip' : 'overdue cars'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                  >
                    <X size={12} /> Clear
                  </button>
                </div>
              )}
            </div>

            <ul className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
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
                <li className="px-1 py-6 text-sm text-ink-500">
                  {filter !== 'all' ? (
                    <>
                      No cars {filter === 'requests' ? 'with pending requests' : filter === 'trip' ? 'on a trip' : 'overdue'}
                      {search && ' match your search'}.{' '}
                      <button
                        type="button"
                        onClick={() => setFilter('all')}
                        className="font-medium text-brand-600 hover:underline"
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
              'lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain',
            )}
          >
            {selected ? (
              <CarDetail
                listing={selected}
                bookings={bookingsByCar.get(selected.id) ?? []}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <Card>
                <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-ink-400">
                  <Car size={26} />
                  <p className="text-sm">Select a listing to manage its requests and trips.</p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type StatTone = 'muted' | 'brand' | 'info' | 'amber' | 'green' | 'red';
type TrendTone = 'up' | 'warn' | 'danger' | 'muted';

/** Tinted icon-chip background/foreground per metric tone. */
const STAT_CHIP: Record<StatTone, string> = {
  muted: 'bg-ink-100 text-ink-500',
  brand: 'bg-brand-50 text-brand-600',
  info: 'bg-info-50 text-info-600',
  amber: 'bg-amber-50 text-amber-600',
  green: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
};
const TREND_COLOR: Record<TrendTone, string> = {
  up: 'text-emerald-600',
  warn: 'text-amber-600',
  danger: 'text-red-600',
  muted: 'text-ink-400',
};

/**
 * One metric as a self-contained card: tinted icon chip, label, big value, and a
 * live secondary indicator. With an `onClick` it filters the fleet below (hover
 * lift + active ring); money totals are static.
 */
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  trend,
  onClick,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: StatTone;
  trend?: { label: string; tone: TrendTone };
  onClick?: () => void;
  active?: boolean;
}) {
  const inner = (
    <>
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', STAT_CHIP[tone])}>
        <Icon size={18} />
      </span>
      <div className="mt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
        <p className="mt-0.5 truncate text-2xl font-bold leading-tight tabular-nums text-ink-900">{value}</p>
        {trend && (
          <p className={cn('mt-1 flex items-center gap-1 text-xs font-medium', TREND_COLOR[trend.tone])}>
            {trend.tone === 'up' && <TrendingUp size={13} />}
            {trend.label}
          </p>
        )}
      </div>
    </>
  );

  const base = 'flex flex-col rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-card';
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
        'transition-all hover:-translate-y-0.5 hover:shadow-card-hover active:translate-y-0',
        active && 'border-brand-300 ring-1 ring-brand-200',
      )}
    >
      {inner}
    </button>
  );
}

function MiniStat({
  label,
  value,
  highlight,
  tone = 'brand',
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: 'brand' | 'info';
}) {
  const on = highlight
    ? tone === 'info'
      ? 'border-info-200 bg-info-50'
      : 'border-brand-200 bg-brand-50'
    : 'border-ink-100 bg-ink-50/60';
  const valueColor = highlight ? (tone === 'info' ? 'text-info-700' : 'text-brand-700') : 'text-ink-900';
  return (
    <div className={cn('rounded-lg border px-3 py-2', on)}>
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cn('text-base font-bold leading-tight', valueColor)}>{value}</p>
    </div>
  );
}

function Centered() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={24} />
    </div>
  );
}

/** Something went wrong loading a query — let the host retry instead of staring at zeros. */
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="mt-6">
      <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle size={20} />
        </span>
        <p className="text-sm text-ink-600">Couldn't load this. Check your connection and try again.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw size={14} /> Retry
        </Button>
      </CardBody>
    </Card>
  );
}

/** Placeholder bars that match the master–detail layout so it doesn't jump on load. */
function FleetSkeleton() {
  return (
    <div className="mt-6 grid animate-pulse gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2">
        <div className="h-10 rounded-lg bg-ink-100" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-ink-100 p-2.5">
            <div className="h-14 w-20 shrink-0 rounded-lg bg-ink-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/4 rounded bg-ink-100" />
              <div className="h-3 w-1/2 rounded bg-ink-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden h-72 rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 lg:block" />
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
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Car size={22} />
        </span>
        <div>
          <p className="text-base font-semibold text-ink-900">Start hosting in three steps</p>
          <p className="mt-1 text-sm text-ink-500">Add your first vehicle to begin earning.</p>
        </div>
        <ol className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-ink-100 bg-ink-50/60 p-4 text-left">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-600 ring-1 ring-ink-100">
                <s.icon size={16} />
              </span>
              <p className="mt-2 text-sm font-semibold text-ink-900">
                {i + 1}. {s.title}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">{s.body}</p>
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

/** A row in the left rail: thumbnail, title, status + pending-request badge. */
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
          'flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all',
          active
            ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200'
            : 'border-ink-200 bg-white hover:border-ink-300 hover:shadow-sm',
        )}
      >
        <Img src={listing.photos[0]} alt={listing.title} className="h-14 w-20 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">{listing.title}</p>
          <p className="truncate text-xs text-ink-500">
            {listingPriceLabel(listing)}{activity ? ` · ${activity}` : ''}
          </p>
          <span className="mt-1 inline-flex flex-wrap gap-1">
            <Badge tone={status.tone}>{status.label}</Badge>
            {overdue && (
              <Badge tone="danger">
                <AlertTriangle size={11} /> Overdue
              </Badge>
            )}
          </span>
        </div>
        {open > 0 && (
          <span
            className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white"
            title={`${open} active booking${open === 1 ? '' : 's'} (not completed)`}
          >
            {open}
          </span>
        )}
      </button>
    </li>
  );
}

/** Right pane: the selected car's header, sub-tabs and content. */
function CarDetail({ listing, bookings, onBack }: { listing: Listing; bookings: Booking[]; onBack: () => void }) {
  const [tab, setTab] = useState<CarTab>('requests');
  const status = carStatusBadge(listing, bookings);
  const s = bookingStats(bookings);
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
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 lg:hidden"
        >
          <ChevronLeft size={16} /> Fleet
        </button>
        <div className="flex items-start gap-3">
          <Img src={listing.photos[0]} alt={listing.title} className="h-16 w-24 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-ink-900">{listing.title}</h2>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-500">{listing.location}</p>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-ink-600">
              <span className="font-semibold text-ink-900">{listingPriceLabel(listing)}</span>
              <span className="inline-flex items-center gap-1 text-ink-500">
                <Star size={13} className="fill-accent-500 text-accent-500" />
                {listing.ratingCount ? listing.ratingAvg?.toFixed(1) : 'New'}
              </span>
            </p>
          </div>
          <Link
            to={`/cars/${listing.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
          >
            <ExternalLink size={14} /> View
          </Link>
        </div>

        {overdue.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {overdue.length === 1 ? 'A trip is' : `${overdue.length} trips are`} overdue — the car was due
              back on {overdue.map((b) => formatDate(b.endDate)).join(', ')} but isn't completed. The renter has
              been notified.
            </span>
          </div>
        )}

        {/* Per-car numbers */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Requests" value={`${s.pending}`} highlight={s.pending > 0} tone="info" />
          <MiniStat label="Upcoming" value={`${s.upcoming}`} />
          <MiniStat label="On trip" value={`${s.active}`} />
          <MiniStat label="Earned" value={formatRwf(s.earned)} />
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 border-b border-ink-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              {t.label}
              {t.badge !== undefined && (
                <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'requests' &&
          (requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No pending requests for this listing.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((b) => (
                <RequestRow key={b.id} booking={b} />
              ))}
            </div>
          ))}

        {tab === 'trips' &&
          (trips.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No trips for this listing yet.</p>
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
function RequestRow({ booking }: { booking: Booking }) {
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
          <p className="text-sm font-medium text-ink-900">
            {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
            <span className="font-normal text-ink-500">
              {' '}
              · {booking.days} day{booking.days === 1 ? '' : 's'}
            </span>
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink-900">{formatRwf(booking.totalRwf)}</p>
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
          <span className="mx-0.5 h-5 w-px bg-ink-200" />
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
            <span className="font-medium text-ink-900">
              {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
            </span>{' '}
            ({booking.days} day{booking.days === 1 ? '' : 's'} ·{' '}
            <span className="font-medium text-ink-900">{formatRwf(booking.totalRwf)}</span>).
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
      <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5">
        <p className="text-sm text-ink-600">Photos, specs, location, booking mode…</p>
        <Link to={`/cars/${listing.id}/edit`}>
          <Button variant="outline" size="sm">
            <Pencil size={14} /> Edit car details
          </Button>
        </Link>
      </div>

      {/* Pricing */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-700">Price per day ({listing.priceCurrency})</p>
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

      {listing.hourlyBookingEnabled && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700">Price per hour ({listing.priceCurrency})</p>
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
        <p className="mb-1.5 text-sm font-medium text-ink-700">Maintenance</p>
        {inMaintenance ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-600">
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
            <span className="text-sm text-ink-600">Back in service on</span>
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
        <p className="mb-1.5 text-sm font-medium text-ink-700">Blocked / personal-use dates</p>
        {listing.blockedDates.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {listing.blockedDates.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700">
                {formatDate(d)}
                <button
                  type="button"
                  onClick={() => mutation.mutate({ blockedDates: listing.blockedDates.filter((x) => x !== d) })}
                  className="text-ink-400 hover:text-ink-700"
                  aria-label={`Unblock ${d}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-sm text-ink-500">No blocked dates — available throughout.</p>
        )}
        <div className="flex items-center gap-2">
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
  if (!PAYMENTS_PAYHOLD || host.payholdSellerId) return null;

  return (
    <Card className="mt-5 border-amber-300 bg-amber-50">
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <AlertTriangle size={15} />
          </span>
          <div>
            <p className="font-semibold text-ink-900">Reconnect your payout account</p>
            <p className="mt-0.5 max-w-xl text-sm text-ink-700">
              We've moved to a new payments system that holds each renter's money until the trip
              is done. For your security we never stored your full account number, so please
              enter it once more.{' '}
              <span className="font-medium">
                Until you do, your cars can't be booked.
              </span>
            </p>
          </div>
        </div>
        <Link to="/payouts/setup">
          <Button>Reconnect</Button>
        </Link>
      </CardBody>
    </Card>
  );
}

/**
 * New-host setup steps that unblock earning. Hides itself once all are done.
 * Verification is one of the steps, so this doubles as the verification nudge.
 */
function SetupChecklist({ host, listingCount }: { host: Host; listingCount: number }) {
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
    <Card className="mt-5 border-brand-200 bg-brand-50/40">
      <CardBody>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 font-semibold text-ink-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
              <ShieldCheck size={15} />
            </span>
            Finish setting up
          </h2>
          <span className="text-sm text-ink-500">
            {doneCount} of {steps.length} done
          </span>
        </div>
        <ul className="mt-3 space-y-2.5">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              {s.done ? (
                <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
              ) : (
                <Circle size={18} className="shrink-0 text-ink-300" />
              )}
              <span className={cn('flex-1 text-sm', s.done ? 'text-ink-400 line-through' : 'text-ink-800')}>
                {s.label}
              </span>
              {!s.done &&
                (s.muted ? (
                  <span className="text-xs font-medium text-ink-500">{s.cta}</span>
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
      </CardBody>
    </Card>
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
    <Card className="mt-6 border-brand-200 shadow-md ring-1 ring-brand-100">
      <CardBody>
        <h2 className="flex items-center gap-2.5 font-semibold text-ink-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
            <AlertTriangle size={15} />
          </span>
          Action needed
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
            {items.length}
          </span>
        </h2>
        <ul className="mt-2 divide-y divide-ink-100">
          {items.map((it) => (
            <ActionRow
              key={`${it.kind}-${it.booking.id}`}
              item={it}
              listing={listingsById.get(it.booking.listingId)}
              onReview={() => setReviewing(it.booking)}
            />
          ))}
        </ul>
      </CardBody>

      <RequesterModal
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        renterId={reviewing?.renterId ?? ''}
        onDecide={(action) => mutation.mutate(action)}
        deciding={mutation.isPending}
      />
    </Card>
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
    <li className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-ink-50">
      <Img src={listing?.photos[0]} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-1.5 text-sm font-medium', overdue ? 'text-red-600' : 'text-ink-900')}>
          <Icon size={15} /> {label}
        </p>
        <p className="truncate text-xs text-ink-500">
          {listing?.title ?? 'Car'} · {formatDate(b.startDate)} – {formatDate(b.endDate)} · {formatRwf(b.totalRwf)}
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

function PayoutsView({ payouts }: { payouts: Payout[] }) {
  // Under PayHold these rows are a local shadow of a ledger it owns. The real
  // answer — what has cleared, what is still holding, when it lands — lives on
  // /earnings, so point there rather than letting a host trust a stale copy.
  const earningsLink = PAYMENTS_PAYHOLD ? (
    <Link
      to="/earnings"
      className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 hover:bg-brand-50"
    >
      <span>
        <span className="block text-sm font-medium text-ink-900">See your full earnings</span>
        <span className="block text-xs text-ink-600">
          Every trip, what stage its money is at, and when it reaches you.
        </span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-brand-600" />
    </Link>
  ) : null;

  if (payouts.length === 0) {
    return (
      <>
        {earningsLink}
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-12 text-center text-ink-500">
            <Banknote size={22} />
            <p className="text-sm">No payouts yet.</p>
          </CardBody>
        </Card>
      </>
    );
  }
  const due = payouts.filter((p) => p.status !== 'paid');
  const paid = payouts.filter((p) => p.status === 'paid');
  const dueTotal = due.reduce((sum, p) => sum + p.amountRwf, 0);
  const paidTotal = paid.reduce((sum, p) => sum + p.amountRwf, 0);
  const nextPayout = due
    .map((p) => p.scheduledFor)
    .filter(Boolean)
    .sort()[0];

  const Group = ({ title, items }: { title: string; items: Payout[] }) =>
    items.length === 0 ? null : (
      <div>
        <p className="px-1 pb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">{title}</p>
        <Card>
          <ul className="divide-y divide-ink-100">
            {items.map((p) => {
              const status = PAYOUT_STATUS_META[p.status];
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div>
                    <p className="font-medium text-ink-900">{formatRwf(p.amountRwf)}</p>
                    <p className="text-sm text-ink-500">
                      {PAYOUT_CHANNEL_LABEL[p.channel]} ·{' '}
                      {p.paidAt ? `Paid ${formatDate(p.paidAt)}` : `Due ${formatDate(p.scheduledFor)}`}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    );

  return (
    <div className="space-y-5">
      {earningsLink}
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Due" value={formatRwf(dueTotal)} highlight={dueTotal > 0} />
        <MiniStat label="Paid out" value={formatRwf(paidTotal)} />
      </div>
      {nextPayout && (
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <Banknote size={15} className="text-brand-600" /> Next payout {formatDate(nextPayout)}.
        </p>
      )}
      <Group title="Scheduled" items={due} />
      <Group title="Paid" items={paid} />
    </div>
  );
}
