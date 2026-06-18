import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Car } from 'lucide-react';
import { mockClient } from '@/mocks/client';
import { TRIP_GROUPS } from '@/lib/trips';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { TripCard } from '@/components/TripCard';

/**
 * A3 — "My trips". Lists the current user's bookings grouped by lifecycle
 * stage (upcoming / active / past). Bookings join to their listing for the
 * car photo + title. Handles loading + empty states.
 */
export function TripsPage() {
  const bookingsQuery = useQuery({
    queryKey: ['bookings'],
    queryFn: () => mockClient.listBookings(),
  });
  const listingsQuery = useQuery({
    queryKey: ['listings'],
    queryFn: () => mockClient.listListings(),
  });

  const isLoading = bookingsQuery.isLoading || listingsQuery.isLoading;
  const bookings = bookingsQuery.data ?? [];
  const listingsById = new Map((listingsQuery.data ?? []).map((l) => [l.id, l]));

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-ink-900">My trips</h1>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : bookings.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Car size={32} className="text-ink-300" />
            <div>
              <p className="font-medium text-ink-900">No trips yet</p>
              <p className="mt-1 text-sm text-ink-500">
                Browse cars and book your first trip.
              </p>
            </div>
            <Link to="/">
              <Button size="sm">Explore cars</Button>
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-8">
          {TRIP_GROUPS.map((group) => {
            const groupBookings = bookings.filter((b) => group.states.includes(b.state));
            if (groupBookings.length === 0) return null;
            return (
              <div key={group.key}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
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
        </div>
      )}
    </section>
  );
}
