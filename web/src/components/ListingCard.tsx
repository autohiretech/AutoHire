import { Link } from 'react-router-dom';
import { Building2, User } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { formatRwf } from '@/lib/format';
import { Badge, Card, CardBody, Rating } from '@/components/ui';

/**
 * Listing summary card used on the browse grid (A1). Links to the car detail
 * page (A2), whose CTA continues into the booking flow (A3). The `compact`
 * variant shrinks the image and padding for the denser marketplace grid.
 */
export function ListingCard({ listing, compact = false }: { listing: Listing; compact?: boolean }) {
  const isBusiness = listing.ownerType === 'business';

  return (
    <Link to={`/cars/${listing.id}`} className="group block focus:outline-none">
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-600/40">
        <img
          src={listing.photos[0]}
          alt={listing.title}
          className={cn('w-full object-cover', compact ? 'h-32' : 'h-44')}
        />
        <CardBody className={cn(compact && 'p-3 sm:p-3')}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <Badge tone={isBusiness ? 'accent' : 'brand'}>
              {isBusiness ? (
                <>
                  <Building2 size={12} /> {compact ? 'Business' : 'Business host'}
                </>
              ) : (
                <>
                  <User size={12} /> {compact ? 'Individual' : 'Individual host'}
                </>
              )}
            </Badge>
            <Rating value={listing.ratingAvg} count={listing.ratingCount} />
          </div>
          <h3 className={cn('line-clamp-1 font-semibold text-ink-900', compact && 'text-sm')}>
            {listing.title}
          </h3>
          <p className={cn('text-ink-500', compact ? 'text-xs' : 'text-sm')}>{listing.location}</p>
          {!compact && (
            <p className="mt-0.5 text-xs text-ink-400 capitalize">
              {listing.category} · {listing.transmission} · {listing.seats} seats
            </p>
          )}
          <div className={cn('flex items-center justify-between', compact ? 'mt-2' : 'mt-3')}>
            <span className={cn('font-semibold text-ink-900', compact && 'text-sm')}>
              {formatRwf(listing.pricePerDayRwf)}
              <span className="font-normal text-ink-500"> / day</span>
            </span>
            {!compact && (
              <Badge tone={listing.bookingMode === 'instant' ? 'success' : 'neutral'}>
                {listing.bookingMode === 'instant' ? 'Instant book' : 'Request to book'}
              </Badge>
            )}
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
