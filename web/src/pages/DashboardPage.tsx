import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarClock, Car, Check, Plus, X } from 'lucide-react';
import type { Booking, Listing } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { PAYOUT_CHANNEL_LABEL, PAYOUT_STATUS_META } from '@/lib/payouts';
import { TripCard } from '@/components/TripCard';
import { Badge, Button, Card, CardBody, CardHeader, Input, Spinner } from '@/components/ui';

type Tab = 'listings' | 'requests' | 'payouts' | 'trips';

/**
 * A4 — Owner / host dashboard. Host-scoped view (the demo host is a fleet
 * business): manage listings (pricing + block personal-use dates), act on
 * incoming booking requests, and review payout history across MoMo / Airtel /
 * bank rails.
 */
export function DashboardPage() {
  const [tab, setTab] = useState<Tab>('listings');

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
  const listings = listingsQuery.data ?? [];
  const bookings = bookingsQuery.data ?? [];
  const payouts = payoutsQuery.data ?? [];
  const requests = bookings.filter((b) => b.state === 'requested');
  const scheduledTotal = payouts
    .filter((p) => p.status !== 'paid')
    .reduce((sum, p) => sum + p.amountRwf, 0);

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'listings', label: 'My listings' },
    { key: 'requests', label: 'Requests', badge: requests.length || undefined },
    { key: 'trips', label: 'Trips' },
    { key: 'payouts', label: 'Payouts' },
  ];
  const listingsById = new Map(listings.map((l) => [l.id, l]));

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Host dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            {host ? host.businessName ?? host.fullName : 'Loading…'}
          </p>
        </div>
        <Link to="/cars/new">
          <Button>
            <Plus size={16} /> List a car
          </Button>
        </Link>
      </div>

      {/* Summary stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={<Car size={18} />} label="Vehicles" value={`${listings.length}`} />
        <Stat icon={<CalendarClock size={18} />} label="Pending requests" value={`${requests.length}`} />
        <Stat
          icon={<Check size={18} />}
          label="Upcoming trips"
          value={`${bookings.filter((b) => b.state === 'confirmed').length}`}
        />
        <Stat icon={<Banknote size={18} />} label="Payouts due" value={formatRwf(scheduledTotal)} />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex gap-1 border-b border-ink-200">
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
        {tab === 'listings' && (
          <TabState query={listingsQuery}>
            {listings.length === 0 ? (
              <Card>
                <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Car size={20} />
                  </span>
                  <p className="text-sm text-ink-500">
                    No cars listed yet. Add your first vehicle to start hosting.
                  </p>
                  <Link to="/cars/new">
                    <Button>
                      <Plus size={16} /> List a car
                    </Button>
                  </Link>
                </CardBody>
              </Card>
            ) : (
              <div className="space-y-4">
                {listings.map((l) => (
                  <ListingManageCard
                    key={l.id}
                    listing={l}
                    bookings={bookings.filter((b) => b.listingId === l.id)}
                  />
                ))}
              </div>
            )}
          </TabState>
        )}

        {tab === 'requests' && (
          <TabState query={bookingsQuery}>
            {requests.length === 0 ? (
              <EmptyCard text="No pending requests right now." />
            ) : (
              <div className="space-y-4">
                {requests.map((b) => (
                  <RequestCard
                    key={b.id}
                    booking={b}
                    listing={listings.find((l) => l.id === b.listingId)}
                  />
                ))}
              </div>
            )}
          </TabState>
        )}

        {tab === 'trips' && (
          <TabState query={bookingsQuery}>
            {bookings.length === 0 ? (
              <EmptyCard text="No trips yet." />
            ) : (
              <div className="space-y-3">
                {bookings.map((b) => (
                  <TripCard key={b.id} booking={b} listing={listingsById.get(b.listingId)} />
                ))}
              </div>
            )}
          </TabState>
        )}

        {tab === 'payouts' && (
          <TabState query={payoutsQuery}>
            <Card>
              <ul className="divide-y divide-ink-100">
                {payouts.map((p) => {
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
          </TabState>
        )}
      </div>
    </section>
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

/** Wraps a tab body with a loading spinner while its query is in flight. */
function TabState({
  query,
  children,
}: {
  query: { isLoading: boolean };
  children: React.ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  }
  return <>{children}</>;
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card>
      <CardBody className="py-12 text-center text-sm text-ink-500">{text}</CardBody>
    </Card>
  );
}

/** Incoming booking request with approve / decline actions. */
function RequestCard({ booking, listing }: { booking: Booking; listing?: Listing }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: 'approve' | 'decline') => client.respondToBooking(booking.id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <img
          src={listing?.photos[0]}
          alt={listing?.title ?? 'Car'}
          className="h-20 w-28 shrink-0 rounded-lg object-cover"
        />
        <div className="flex-1">
          <p className="font-medium text-ink-900">{listing?.title ?? 'Car'}</p>
          <p className="text-sm text-ink-500">
            {formatDate(booking.startDate)} – {formatDate(booking.endDate)} · {booking.days} day
            {booking.days === 1 ? '' : 's'}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink-900">{formatRwf(booking.totalRwf)}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutation.mutate('decline')}
            disabled={mutation.isPending}
          >
            Decline
          </Button>
          <Button size="sm" onClick={() => mutation.mutate('approve')} disabled={mutation.isPending}>
            Approve
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Manage a single listing: edit price, set maintenance, block personal-use dates. */
function ListingManageCard({ listing, bookings }: { listing: Listing; bookings: Booking[] }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(listing.pricePerDayRwf));
  const [newDate, setNewDate] = useState('');
  const [maintDate, setMaintDate] = useState(listing.maintenanceUntil ?? '');

  const mutation = useMutation({
    mutationFn: (
      patch: Partial<Pick<Listing, 'pricePerDayRwf' | 'blockedDates' | 'status' | 'maintenanceUntil'>>,
    ) => client.updateListing(listing.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownerListings'] });
      queryClient.invalidateQueries({ queryKey: ['listing', listing.id] });
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const inMaintenance = listing.status === 'maintenance';
  // A car is "booked now" if a live trip covers today.
  const bookedNow = bookings.some(
    (b) =>
      !['cancelled', 'declined', 'completed', 'requested'].includes(b.state) &&
      b.startDate <= today &&
      b.endDate > today,
  );
  const statusBadge = inMaintenance
    ? {
        tone: 'warning' as const,
        label: `In maintenance${listing.maintenanceUntil ? ` · back ${formatDate(listing.maintenanceUntil)}` : ''}`,
      }
    : bookedNow
      ? { tone: 'accent' as const, label: 'Booked now' }
      : { tone: 'success' as const, label: 'Available' };

  const priceChanged = Number(price) !== listing.pricePerDayRwf && Number(price) > 0;

  function addBlockedDate() {
    if (!newDate || listing.blockedDates.includes(newDate)) return;
    mutation.mutate({ blockedDates: [...listing.blockedDates, newDate].sort() });
    setNewDate('');
  }

  function removeBlockedDate(date: string) {
    mutation.mutate({ blockedDates: listing.blockedDates.filter((d) => d !== date) });
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <img src={listing.photos[0]} alt={listing.title} className="h-10 w-14 rounded object-cover" />
        <div className="flex-1">
          <p className="font-medium text-ink-900">{listing.title}</p>
          <p className="text-xs text-ink-500">{listing.location}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
          <Badge tone="neutral">
            {listing.bookingMode === 'instant' ? 'Instant book' : 'Request to book'}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        {/* Pricing */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700">Price per day (RWF)</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="max-w-40"
            />
            <Button
              size="sm"
              disabled={!priceChanged || mutation.isPending}
              onClick={() => mutation.mutate({ pricePerDayRwf: Number(price) })}
            >
              Save
            </Button>
          </div>
        </div>

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
              <Input
                type="date"
                min={today}
                value={maintDate}
                onChange={(e) => setMaintDate(e.target.value)}
                className="max-w-48"
              />
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

        {/* Availability */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700">Blocked / personal-use dates</p>
          {listing.blockedDates.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {listing.blockedDates.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700"
                >
                  {formatDate(d)}
                  <button
                    type="button"
                    onClick={() => removeBlockedDate(d)}
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
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="max-w-48"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={addBlockedDate}
              disabled={!newDate || mutation.isPending}
            >
              <Plus size={15} /> Block date
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
