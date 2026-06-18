import { Link } from 'react-router-dom';
import { Building2, User } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { formatRwf } from '@/lib/format';
import { Badge, Card, CardBody, Rating } from '@/components/ui';

/**
 * Listing summary card used on the browse grid (A1) and reused by detail /
 * trip screens later. Links to the car detail page (A2).
 */
export function ListingCard({ listing }: { listing: Listing }) {
  const isBusiness = listing.ownerType === 'business';

  return (
    <Link to={`/cars/${listing.id}`} className="group block focus:outline-none">
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-600/40">
        <img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-44 w-full object-cover"
        />
        <CardBody>
          <div className="mb-1 flex items-center justify-between gap-2">
            <Badge tone={isBusiness ? 'accent' : 'brand'}>
              {isBusiness ? (
                <>
                  <Building2 size={12} /> Business host
                </>
              ) : (
                <>
                  <User size={12} /> Individual host
                </>
              )}
            </Badge>
            <Rating value={listing.ratingAvg} count={listing.ratingCount} />
          </div>
          <h3 className="line-clamp-1 font-semibold text-ink-900">{listing.title}</h3>
          <p className="text-sm text-ink-500">{listing.location}</p>
          <p className="mt-0.5 text-xs text-ink-400 capitalize">
            {listing.category} · {listing.transmission} · {listing.seats} seats
          </p>
          <div className="mt-3 flex items-center justify-between">
            <span className="font-semibold text-ink-900">
              {formatRwf(listing.pricePerDayRwf)}
              <span className="font-normal text-ink-500"> / day</span>
            </span>
            <Badge tone={listing.bookingMode === 'instant' ? 'success' : 'neutral'}>
              {listing.bookingMode === 'instant' ? 'Instant book' : 'Request to book'}
            </Badge>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
