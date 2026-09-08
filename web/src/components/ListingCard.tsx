import { Link } from 'react-router-dom';
import { Building2, Star } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { listingHeadlinePrice } from '@/lib/pricing';
import { Badge } from '@/components/ui';

/**
 * Listing summary card used on every browse grid (home, search, watchlist) so
 * a car looks the same size wherever it's shown. Links to the car detail page,
 * whose CTA continues into the booking flow.
 *
 * **The card is a photograph with four lines under it, and nothing else.** It
 * previously carried a border, a shadow, a hover lift, a hover zoom, two
 * badges and a rating block — nine competing signals on an object whose job is
 * to make one car look worth tapping. Turo and Getaround both strip this to
 * photo → title+rating → location → price, and the density is what lets a
 * phone show three cars instead of one and a half.
 *
 * What survived, and why:
 * • the **rating** moved onto the title row, right-aligned — it is read as a
 *   property of the car, not as a separate badge.
 * • the **host type** is now an overlay badge only for business hosts. Every
 *   card saying "Individual host" was a label on the default case, which is
 *   noise; "Business host" is the exception worth flagging.
 * • the **spec line** (category · transmission · seats) is gone from the card.
 *   Nobody chooses between two cars on transmission at grid scale, and it cost
 *   a line on every card to say so. It lives on the detail page.
 *
 * `isActive`/`onHover` sync the card with its map pin — hovering either
 * highlights both. `layout="row"` is the horizontal form used inside the
 * mobile results sheet and the desktop results list, where a full-width photo
 * would show one car per screen.
 */
export function ListingCard({
  listing,
  isActive,
  onHover,
  layout = 'stacked',
}: {
  listing: Listing;
  isActive?: boolean;
  onHover?: (hovering: boolean) => void;
  layout?: 'stacked' | 'row';
}) {
  const isBusiness = listing.ownerType === 'business';
  const price = listingHeadlinePrice(listing);
  const row = layout === 'row';

  return (
    <Link
      to={`/cars/${listing.id}`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={cn(
        'group block min-w-0 rounded-[var(--radius-card)]',
        // The active ring is offset so it reads as a highlight around the card
        // rather than a border on the photo.
        isActive && 'ring-2 ring-[var(--color-accent-on)] ring-offset-2',
        row ? 'flex gap-3' : 'h-full',
      )}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)]',
          row ? 'w-32 sm:w-40' : 'w-full',
        )}
      >
        <Img
          src={listing.photos[0]}
          alt={listing.title}
          className={cn(
            'w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
            // 4:3 throughout. A square photo in the row layout stood taller
            // than the three lines of text beside it, so every row carried a
            // band of dead space under the title — the photo was setting the
            // height instead of the content.
            'aspect-[4/3]',
          )}
        />
        {isBusiness && (
          <Badge tone="overlay" className="absolute top-2 left-2">
            <Building2 size={11} /> Business
          </Badge>
        )}
      </div>

      {/* On a phone the card runs one notch denser than the page's own scale:
          a 13px medium title, 12px meta, 13px price. A card title is not a
          heading — it is one of many in a grid, read by scanning, and at
          heading weight a rail of them reads as a wall of bold. Desktop keeps
          the h4 treatment from `sm` up. */}
      <div className={cn('min-w-0', row ? 'flex-1 py-0.5' : 'pt-2 sm:pt-3')}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-body-sm font-medium text-[var(--color-content)] sm:text-h4 sm:font-semibold">
            {listing.title}
          </h3>
          {listing.ratingCount > 0 && (
            <span className="tabular flex shrink-0 items-center gap-1 text-caption font-semibold text-[var(--color-content)] sm:text-body-sm">
              <Star size={12} className="fill-current text-[var(--color-accent-on)]" />
              {listing.ratingAvg.toFixed(1)}
              <span className="font-normal text-[var(--color-content-subtle)]">
                ({listing.ratingCount})
              </span>
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-caption text-[var(--color-content-muted)] sm:text-body-sm">
          {listing.location}
        </p>

        {/* Price last and heaviest — it is what the eye lands on after the
            photo, and the unit stays light so the number itself carries. */}
        <p className="tabular mt-1 text-body-sm text-[var(--color-content)] sm:mt-1.5">
          <span className="font-bold">
            <Price amount={price.amount} currency={listing.priceCurrency} />
          </span>
          <span className="text-caption text-[var(--color-content-muted)] sm:text-body-sm">
            {' '}
            / {price.unit}
          </span>
        </p>
      </div>
    </Link>
  );
}
