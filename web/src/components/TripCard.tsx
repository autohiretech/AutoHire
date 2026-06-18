import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import type { Booking, Listing } from '@autohire/shared';
import { formatDate, formatRwf } from '@/lib/format';
import { TRIP_STATE_META } from '@/lib/trips';
import { Badge, Card, CardBody } from '@/components/ui';

/** A single trip in the "My trips" list. Links to the trip detail page. */
export function TripCard({ booking, listing }: { booking: Booking; listing?: Listing }) {
  const state = TRIP_STATE_META[booking.state];

  return (
    <Link to={`/trips/${booking.id}`} className="group block focus:outline-none">
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-600/40">
        <div className="flex">
          <img
            src={listing?.photos[0]}
            alt={listing?.title ?? 'Car'}
            className="h-28 w-28 shrink-0 object-cover sm:h-32 sm:w-40"
          />
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 font-semibold text-ink-900">
                {listing?.title ?? 'Car'}
              </h3>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
              <CalendarDays size={15} />
              {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
              <span className="text-ink-400">· {booking.days} day{booking.days === 1 ? '' : 's'}</span>
            </p>
            <p className="mt-auto pt-3 font-semibold text-ink-900">
              {formatRwf(booking.totalRwf)}
            </p>
          </CardBody>
        </div>
      </Card>
    </Link>
  );
}
