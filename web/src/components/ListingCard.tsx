import { Link } from 'react-router-dom';
import { Building2, Star } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { WatchButton } from '@/components/WatchButton';
import { listingHeadlinePrice } from '@/lib/pricing';
import { hiddenVehicleName } from '@/lib/vehicleName';
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
 * • the **year, rating and review count** sit on one line under the title —
 *   read together as one property of the car ("2020, 5.0 from 126 trips"),
 *   the way Turo/Getaround both do it, rather than the rating competing with
 *   the title for the same line.
 * • the **host type** is now an overlay badge only for business hosts. Every
 *   card saying "Individual host" was a label on the default case, which is
 *   noise; "Business host" is the exception worth flagging.
 * • the **make and model** join the year on that same line, but only when
 *   the host's own title doesn't already say them. Model designations are
 *   search terms — somebody looking for an E30 types "e30" — and the card was
 *   the one place that term never appeared; see `lib/vehicleName.ts`.
 * • the **spec line** (category · transmission · seats) is gone from the card.
 *   Nobody chooses between two cars on transmission at grid scale, and it cost
 *   a line on every card to say so. It lives on the detail page.
 * • the **save button** overlays the photo's top-right corner — the one
 *   action worth taking without leaving the grid, so it doesn't cost a line
 *   of text the way a labelled button would.
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
  tripUnits,
}: {
  listing: Listing;
  isActive?: boolean;
  onHover?: (hovering: boolean) => void;
  layout?: 'stacked' | 'row';
  /** Days (or hours, for an hourly-only car) in the renter's currently
   * selected trip — e.g. `endDate - startDate` from the search filters.
   * Undefined/0 when no dates are picked yet, in which case the card shows
   * only the day/hour rate, same as before there was a trip to total. */
  tripUnits?: number;
}) {
  const t = useT();
  const isBusiness = listing.ownerType === 'business';
  const price = listingHeadlinePrice(listing);
  const row = layout === 'row';
  const showTotal = !!tripUnits && tripUnits > 0;
  // "Toyota Corolla E120" — printed only when the host's title doesn't already
  // say it. A model designation is a search term (see `vehicleName.ts`), and a
  // card that can't show the term it was found by reads as a wrong result.
  const vehicle = hiddenVehicleName(listing);

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
            <Building2 size={11} /> {t('car.businessShort')}
          </Badge>
        )}
        <WatchButton id={listing.id} variant="icon" className="absolute top-2 right-2" />
      </div>

      {/* On a phone the card runs one notch denser than the page's own scale:
          a 13px medium title, 12px meta, 13px price. A card title is not a
          heading — it is one of many in a grid, read by scanning, and at
          heading weight a rail of them reads as a wall of bold. Desktop keeps
          the h4 treatment from `sm` up. */}
      <div className={cn('min-w-0', row ? 'flex-1 py-0.5' : 'pt-2 sm:pt-3')}>
        <h3 className="min-w-0 truncate text-body-sm font-medium text-[var(--color-content)] sm:text-h4 sm:font-semibold">
          {listing.title}
        </h3>

        {/* Year, what the car actually is, and the rating on one line — read
            as one property of the car, "2020 Toyota Corolla E120 · 5.0 (126)",
            rather than the rating sharing the title's line. No rating yet (a
            brand-new listing) just drops that half.
            The make+model is the only thing here that can be long, so it is
            the only thing allowed to truncate: the rating is what the line is
            for and must not be pushed off the end of a phone by a long model
            name. */}
        <p className="mt-0.5 flex items-center gap-1 text-caption text-[var(--color-content-muted)] sm:text-body-sm">
          <span className="tabular shrink-0">{listing.year}</span>
          {vehicle && <span className="min-w-0 truncate">{vehicle}</span>}
          {listing.ratingCount > 0 && (
            <>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <span className="tabular flex shrink-0 items-center gap-1 font-semibold text-[var(--color-content)]">
                <Star size={12} className="fill-current text-[var(--color-accent-on)]" />
                {listing.ratingAvg.toFixed(1)}
              </span>
              <span className="shrink-0">({listing.ratingCount})</span>
            </>
          )}
        </p>

        <p className="mt-0.5 truncate text-caption text-[var(--color-content-muted)] sm:text-body-sm">
          {listing.location}
        </p>

        {/* Price last and heaviest — it is what the eye lands on after the
            photo, and the unit stays light so the number itself carries. The
            trip total (once dates are picked) sits beside it, lighter, so the
            day rate still reads first. */}
        <p className="tabular mt-1 flex items-baseline gap-1.5 text-body-sm text-[var(--color-content)] sm:mt-1.5">
          <span>
            <span className="font-bold">
              <Price amount={price.amount} currency={listing.priceCurrency} />
            </span>
            <span className="text-caption text-[var(--color-content-muted)] sm:text-body-sm">
              {' '}
              / {t(price.unit === 'day' ? 'car.unitDay' : 'car.unitHour')}
            </span>
          </span>
          {showTotal && (
            <span className="text-caption text-[var(--color-content-muted)] sm:text-body-sm">
              <Price amount={price.amount * tripUnits!} currency={listing.priceCurrency} /> total
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
