import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Car } from 'lucide-react';
import { client } from '@/lib/client';
import { TRIP_GROUPS } from '@/lib/trips';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { TripCard } from '@/components/TripCard';

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

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <h1 className="mb-4 text-h2 text-[var(--color-content)]">My trips</h1>

      {!isLoading && bookings.length > 0 && (
        <div className="mb-6 flex gap-2">
          <Chip selected={filter === 'upcoming'} onClick={() => setFilter('upcoming')}>
            Upcoming
          </Chip>
          <Chip selected={filter === 'ended'} onClick={() => setFilter('ended')}>
            Ended
          </Chip>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : bookings.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Car size={32} className="text-[var(--color-content-subtle)]" />
            <div>
              <p className="font-medium text-[var(--color-content)]">No trips yet</p>
              <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
                Browse cars and book your first trip.
              </p>
            </div>
            <Link to="/">
              <Button size="sm">Explore listings</Button>
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group) => {
            const groupBookings = bookings.filter((b) => group.states.includes(b.state));
            if (groupBookings.length === 0) return null;
            return (
              <div key={group.key}>
                <h2 className="mb-3 text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
                  {group.title}
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
            (g) => bookings.filter((b) => g.states.includes(b.state)).length === 0,
          ) && (
            <p className="py-6 text-center text-body-sm text-[var(--color-content-muted)]">
              {filter === 'upcoming' ? "You don't have any upcoming trips." : 'No past trips yet.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
