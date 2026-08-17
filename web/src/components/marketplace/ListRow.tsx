import { Link } from 'react-router-dom';
import { Building2, User } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { listingHeadlinePrice } from '@/lib/pricing';
import { Badge, Rating } from '@/components/ui';

/** A compact horizontal result row — Getaround's list is thumbnail + facts in
 * one short line, not a tall grid card, so many results are visible without
 * scrolling. Shared by every list+map split view (the AI search page, and
 * Home's own traditional search) so they show results the same way. */
export function ListRow({
  listing,
  isActive,
  onHover,
}: {
  listing: Listing;
  isActive: boolean;
  onHover: (hovering: boolean) => void;
}) {
  const isBusiness = listing.ownerType === 'business';
  const price = listingHeadlinePrice(listing);
  return (
    <Link
      to={`/cars/${listing.id}`}
      className={cn(
        'group flex gap-3 border-l-2 border-transparent p-3 transition-colors hover:bg-ink-50',
        isActive && 'border-l-brand-500 bg-brand-50/70',
      )}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <Img
        src={listing.photos[0]}
        alt={listing.title}
        className="h-20 w-28 shrink-0 rounded-lg object-cover shadow-sm transition-transform duration-200 group-hover:scale-[1.03]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="line-clamp-1 text-sm font-semibold text-ink-900">{listing.title}</h3>
          <Rating value={listing.ratingAvg} count={listing.ratingCount} />
        </div>
        <p className="line-clamp-1 text-xs text-ink-500">{listing.location}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge tone={isBusiness ? 'accent' : 'brand'}>
            {isBusiness ? (
              <>
                <Building2 size={11} /> Business
              </>
            ) : (
              <>
                <User size={11} /> Individual
              </>
            )}
          </Badge>
          {listing.pricingMode === 'hourly' && <Badge tone="brand">Hourly</Badge>}
        </div>
        <p className="mt-1 text-sm font-semibold text-ink-900">
          <Price amount={price.amount} currency={listing.priceCurrency} />
          <span className="font-normal text-ink-500"> / {price.unit}</span>
        </p>
      </div>
    </Link>
  );
}
