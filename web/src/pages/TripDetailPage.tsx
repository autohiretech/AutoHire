import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Camera, Check, MapPin } from 'lucide-react';
import type { CheckPhoto, TripState } from '@autohire/shared';
import { mockClient } from '@/mocks/client';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { TRIP_STATE_META, TRIP_TIMELINE } from '@/lib/trips';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Spinner } from '@/components/ui';

export function TripDetailPage() {
  const { id = '' } = useParams();

  const bookingQuery = useQuery({
    queryKey: ['booking', id],
    queryFn: () => mockClient.getBooking(id),
  });
  const booking = bookingQuery.data;

  const listingQuery = useQuery({
    queryKey: ['listing', booking?.listingId],
    queryFn: () => mockClient.getListing(booking!.listingId),
    enabled: !!booking,
  });
  const hostQuery = useQuery({
    queryKey: ['host', booking?.hostId],
    queryFn: () => mockClient.getHost(booking!.hostId),
    enabled: !!booking,
  });

  if (bookingQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Trip not found</p>
        <Link to="/trips" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to my trips
        </Link>
      </div>
    );
  }

  const listing = listingQuery.data;
  const host = hostQuery.data;
  const state = TRIP_STATE_META[booking.state];
  const isCancelled = booking.state === 'cancelled' || booking.state === 'declined';
  const currentStep = TRIP_TIMELINE.indexOf(booking.state);

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/trips"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> My trips
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink-900">{listing?.title ?? 'Trip'}</h1>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
        {listing && (
          <span className="flex items-center gap-1.5">
            <MapPin size={15} /> {listing.location}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <CalendarDays size={15} /> {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
          <span className="text-ink-400">· {booking.days} day{booking.days === 1 ? '' : 's'}</span>
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {listing && (
            <img
              src={listing.photos[0]}
              alt={listing.title}
              className="h-56 w-full rounded-[var(--radius-card)] object-cover"
            />
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Trip progress</h2>
            </CardHeader>
            <CardBody>
              {isCancelled ? (
                <p className="text-sm text-ink-500">
                  This trip was {state.label.toLowerCase()}.
                </p>
              ) : (
                <ol className="space-y-4">
                  {TRIP_TIMELINE.map((step, i) => {
                    const done = i < currentStep;
                    const current = i === currentStep;
                    return (
                      <li key={step} className="flex items-center gap-3">
                        <span
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs',
                            done && 'border-brand-600 bg-brand-600 text-white',
                            current && 'border-brand-600 text-brand-700',
                            !done && !current && 'border-ink-200 text-ink-400',
                          )}
                        >
                          {done ? <Check size={14} /> : i + 1}
                        </span>
                        <span
                          className={cn(
                            'text-sm',
                            current ? 'font-medium text-ink-900' : 'text-ink-600',
                          )}
                        >
                          {TRIP_STATE_META[step].label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>

          {/* Check-in / check-out photos */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PhotoPanel title="Check-in" photos={booking.checkIn} state={booking.state} />
            <PhotoPanel title="Check-out" photos={booking.checkOut} state={booking.state} />
          </div>
        </div>

        {/* Summary sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Price details</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <Row label={`${formatRwf(listing?.pricePerDayRwf ?? 0)} × ${booking.days} days`} value={formatRwf(booking.subtotalRwf)} />
              <Row label="Service fee" value={formatRwf(booking.serviceFeeRwf)} />
              <div className="border-t border-ink-100 pt-2">
                <Row label="Total" value={formatRwf(booking.totalRwf)} strong />
              </div>
            </CardBody>
          </Card>

          {host && (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink-900">Your host</h2>
              </CardHeader>
              <CardBody className="flex items-center gap-3">
                <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} />
                <div>
                  <p className="font-medium text-ink-900">{host.businessName ?? host.fullName}</p>
                  <p className="text-sm text-ink-500">
                    {host.ownerType === 'business' ? 'Business host' : 'Individual host'}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between', strong ? 'font-semibold text-ink-900' : 'text-ink-600')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Shows captured check-in/out photos, or a placeholder when none exist yet. */
function PhotoPanel({
  title,
  photos,
  state,
}: {
  title: string;
  photos?: CheckPhoto[];
  state: TripState;
}) {
  const active = state === 'active' || state === 'pickup' || state === 'return';
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      </CardHeader>
      <CardBody>
        {photos && photos.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <figure key={p.url}>
                <img src={p.url} alt={p.label} className="h-20 w-full rounded-lg object-cover" />
                <figcaption className="mt-1 text-xs text-ink-500">{p.label}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-200 py-6 text-center">
            <Camera size={20} className="text-ink-300" />
            <p className="text-xs text-ink-500">No photos yet</p>
            <Button variant="outline" size="sm" disabled={!active}>
              Add photos
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
