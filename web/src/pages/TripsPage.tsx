import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Car, Search } from 'lucide-react';
import { client } from '@/lib/client';
import { TRIP_GROUPS } from '@/lib/trips';
import { isTranslationKey, useT } from '@/lib/i18n';
import { Button, Card, CardBody, Chip, Input } from '@/components/ui';
import { TripCard, TripCardSkeleton } from '@/components/TripCard';

/** Which lifecycle groups the Upcoming / Ended filter shows. "Active" trips
    are live right now, so they read as "upcoming" (not yet wrapped up) rather
    than getting a third segment nobody asked for. */
const FILTER_GROUPS: Record<'upcoming' | 'ended', string[]> = {
  upcoming: ['upcoming', 'active'],
  ended: ['past'],
};

/**
 * A3 — "My trips". Lists the current user's bookings grouped by lifecycle
 * stage (upcoming / active / past), behind an Upcoming/Ended segmented
 * filter. Bookings join to their listing for the car photo + title. Handles
 * loading + empty states.
 */
export function TripsPage() {
  const [filter, setFilter] = useState<'upcoming' | 'ended'>('upcoming');
  const [q, setQ] = useState('');
  const t = useT();

  const bookingsQuery = useQuery({
    queryKey: ['bookings'],
    queryFn: () => client.listBookings(),
  });
  const listingsQuery = useQuery({
    queryKey: ['listings'],
    queryFn: () => client.listListings(),
  });

  const isLoading = bookingsQuery.isLoading || listingsQuery.isLoading;
  const bookings = bookingsQuery.data ?? [];
  const listingsById = new Map((listingsQuery.data ?? []).map((l) => [l.id, l]));

  const visibleGroups = TRIP_GROUPS.filter((g) => FILTER_GROUPS[filter].includes(g.key));

  /**
   * Find a trip by the car.
   *
   * A renter with a season of trips behind them is looking for one of them —
   * "the Hiace", "that one in Rubavu" — and Upcoming/Ended does not narrow
   * that at all. The same three fields the host's fleet search uses, because a
   * renter names a car the same way an owner does: what it is, what make it
   * is, or where they picked it up.
   *
   * A trip whose listing is not in the loaded set matches nothing rather than
   * everything — it has no name to match, and letting it through would put
   * unexplained cards in a filtered list.
   */
  const needle = q.trim().toLowerCase();
  const match = (booking: { listingId: string }) => {
    if (!needle) return true;
    const l = listingsById.get(booking.listingId);
    if (!l) return false;
    return (
      l.title.toLowerCase().includes(needle) ||
      `${l.make} ${l.model}`.toLowerCase().includes(needle) ||
      l.location.toLowerCase().includes(needle)
    );
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <h1 className="mb-4 text-h2 text-[var(--color-content)]">{t('nav.myTrips')}</h1>

      {!isLoading && bookings.length > 0 && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Chip selected={filter === 'upcoming'} onClick={() => setFilter('upcoming')}>
              {t('trips.upcoming')}
            </Chip>
            <Chip selected={filter === 'ended'} onClick={() => setFilter('ended')}>
              {t('trips.ended')}
            </Chip>
          </div>
          {/* Beside the segments, not above the list: they are one control
              between them — which trips, and which of those. Full width on a
              phone, where a search field sharing a row with two chips would be
              too narrow to read what you typed. */}
          <div className="relative sm:w-64">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
            />
            <Input
              placeholder={t('trips.searchByCar')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
          {Array.from({ length: 4 }).map((_, i) => (
            <TripCardSkeleton key={i} />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Car size={32} className="text-[var(--color-content-subtle)]" />
            <div>
              <p className="font-medium text-[var(--color-content)]">{t('trips.noTripsYet')}</p>
              <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
                {t('trips.noTripsBody')}
              </p>
            </div>
            <Link to="/">
              <Button size="sm">{t('trips.exploreListings')}</Button>
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group) => {
            const groupBookings = bookings.filter(
              (b) => group.states.includes(b.state) && match(b),
            );
            if (groupBookings.length === 0) return null;
            const titleKey = `trips.group.${group.key}`;
            return (
              <div key={group.key}>
                <h2 className="mb-3 text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
                  {isTranslationKey(titleKey) ? t(titleKey) : group.title}
                </h2>
                <div className="space-y-3">
                  {groupBookings.map((booking) => (
                    <TripCard
                      key={booking.id}
                      booking={booking}
                      listing={listingsById.get(booking.listingId)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {visibleGroups.every(
            (g) => bookings.filter((b) => g.states.includes(b.state) && match(b)).length === 0,
          ) && (
            <p className="py-6 text-center text-body-sm text-[var(--color-content-muted)]">
              {needle
                ? t(filter === 'upcoming' ? 'trips.noUpcomingMatch' : 'trips.noPastMatch', {
                    query: q.trim(),
                  })
                : filter === 'upcoming'
                  ? t('trips.noUpcoming')
                  : t('trips.noPast')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
