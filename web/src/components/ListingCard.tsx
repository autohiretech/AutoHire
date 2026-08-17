import { Link } from 'react-router-dom';
import { Building2, User } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { listingHeadlinePrice } from '@/lib/pricing';
import { Badge, Card, CardBody, Rating } from '@/components/ui';

/**
 * Listing summary card used on every browse grid (home, search, watchlist) so
 * a car looks the same size wherever it's shown. Links to the car detail page
 * (A2), whose CTA continues into the booking flow (A3).
 *
 * `isActive`/`onHover` are optional and unused by every existing caller —
 * added for the map+list results view, where hovering a card highlights its
 * pin and vice versa. A caller that doesn't pass them gets the exact same
 * card as before.
 */
export function ListingCard({
  listing,
  isActive,
  onHover,
}: {
  listing: Listing;
  isActive?: boolean;
  onHover?: (hovering: boolean) => void;
}) {
  const isBusiness = listing.ownerType === 'business';
  const price = listingHeadlinePrice(listing);

  return (
    <Link
      to={`/cars/${listing.id}`}
      className="group block h-full min-w-0 focus:outline-none"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <Card
        className={cn(
          'h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-card-hover group-focus-visible:ring-2 group-focus-visible:ring-brand-600/40',
          isActive && 'ring-2 ring-brand-500',
        )}
      >
        <Img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
          <div className="mt-3 flex items-center gap-2">
            <span className="font-semibold text-ink-900">
              <Price amount={price.amount} currency={listing.priceCurrency} />
              <span className="font-normal text-ink-500"> / {price.unit}</span>
            </span>
            {listing.pricingMode === 'hourly' && <Badge tone="brand">Hourly</Badge>}
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
