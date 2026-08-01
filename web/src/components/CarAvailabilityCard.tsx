import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Star } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { client } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { Badge, Card, CardBody } from '@/components/ui';

type Availability = { tone: 'success' | 'accent' | 'warning'; label: string };

/** A car's availability right now, derived from its status + live bookings. */
export function availabilityFor(
  listing: Listing,
  ranges: { startDate: string; endDate: string }[],
): { now: Availability; upcoming?: { startDate: string; endDate: string } } {
  const today = new Date().toISOString().slice(0, 10);
  if (listing.status === 'maintenance') {
    return {
      now: {
        tone: 'warning',
        label: `Maintenance${listing.maintenanceUntil ? ` · back ${formatDate(listing.maintenanceUntil)}` : ''}`,
      },
    };
  }
  const bookedNow = ranges.find((r) => r.startDate <= today && today < r.endDate);
  const upcoming = ranges
    .filter((r) => r.startDate > today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (bookedNow) {
    return { now: { tone: 'accent', label: `Booked · free ${formatDate(bookedNow.endDate)}` }, upcoming };
  }
  return { now: { tone: 'success', label: 'Available now' }, upcoming };
}

/**
 * A car tile that leads with its live availability — used on the host profile
 * and city pages where "can I get this now?" is the question being answered.
 */
export function CarAvailabilityCard({ listing }: { listing: Listing }) {
  const { data: ranges = [] } = useQuery({
    queryKey: ['bookedRanges', listing.id],
    queryFn: () => client.getBookedRanges(listing.id),
  });
  const { now, upcoming } = availabilityFor(listing, ranges);

  return (
    <Link to={`/cars/${listing.id}`} className="group block h-full focus:outline-none">
      <Card className="h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-card-hover group-focus-visible:ring-2 group-focus-visible:ring-brand-600/40">
        <div className="relative">
          <Img
            src={listing.photos[0]}
            alt={listing.title}
            className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <span className="absolute left-2 top-2">
            <Badge tone={now.tone}>{now.label}</Badge>
          </span>
        </div>
        <CardBody className="p-3">
          <p className="line-clamp-1 text-sm font-semibold text-ink-900">{listing.title}</p>
          <p className="line-clamp-1 text-xs text-ink-500">{listing.location}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink-900">
              <Price amount={listing.pricePerDayRwf} currency={listing.priceCurrency} />
              <span className="font-normal text-ink-500"> / day</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-500">
              <Star size={12} className="fill-accent-500 text-accent-500" />
              {listing.ratingCount ? listing.ratingAvg.toFixed(1) : 'New'}
            </span>
          </div>
          {upcoming && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-400">
              <CalendarClock size={11} />
              Next booked {formatDate(upcoming.startDate)} – {formatDate(upcoming.endDate)}
            </p>
          )}
        </CardBody>
      </Card>
    </Link>
  );
}
