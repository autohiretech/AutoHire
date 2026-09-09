import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { listingHeadlinePrice } from '@/lib/pricing';

/**
 * The collapsed form of `/ai`'s results on a phone: one swipeable row of
 * small cards along the bottom, rather than a sheet of tall photo cards.
 *
 * The problem it solves is that on a map page the map is the thing you came
 * for, and a stack of full-bleed listing cards buried it — the results were
 * either in the way or, once collapsed, gone entirely. A rail keeps both:
 * the map holds the whole screen behind it and the cars stay one thumb-swipe
 * away. It is the pattern every map-first product converges on for the same
 * reason.
 *
 * Deliberately not a shrunken `ListingCard`. That card is photo-led because
 * on a browse grid the photo is what sells the car; here the photo is a
 * thumbnail whose only job is recognition, and the card has to read at a
 * glance while someone is panning a map with their other thumb. So: name,
 * price, rating, nothing else.
 */
export function ResultsRail({
  listings,
  activeId,
  onHover,
  onSelect,
  className,
}: {
  listings: Listing[];
  activeId?: string | null;
  /** Mirrors the sheet's own hover wiring so a card and its map pin light up together. */
  onHover?: (id: string | null) => void;
  onSelect?: (listing: Listing) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `snap-x` so a swipe settles on a card instead of halfway between
        // two. `overscroll-x-contain` keeps a horizontal fling from turning
        // into a browser back-gesture at the end of the rail.
        'flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-1',
        // The scrollbar is noise on a touch rail and steals 8px of card.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {listings.map((l) => {
        const headline = listingHeadlinePrice(l);
        return (
          <Link
            key={l.id}
            to={`/cars/${l.id}`}
            onMouseEnter={() => onHover?.(l.id)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onSelect?.(l)}
            className={cn(
              'flex w-[228px] shrink-0 snap-start items-center gap-2.5 rounded-[var(--radius-card)] border p-2 transition-colors',
              'bg-[var(--color-surface-raised)]',
              // Same "this one" treatment the sheet rows use, so selecting a
              // pin on the map marks the matching card here too.
              l.id === activeId
                ? 'border-[var(--color-accent-on)]'
                : 'border-[var(--color-line)]',
            )}
          >
            <Img
              src={l.photos?.[0] ?? ''}
              alt=""
              className="h-14 w-14 shrink-0 rounded-[var(--radius-control)] object-cover"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-body-sm font-semibold text-[var(--color-content)]">
                {l.title}
              </span>
              <span className="flex items-center gap-1 text-caption text-[var(--color-content-muted)]">
                <Star size={11} className="shrink-0 fill-current text-[var(--color-accent-on)]" />
                <span className="tabular">{l.ratingAvg ? l.ratingAvg.toFixed(1) : '—'}</span>
                <span className="truncate">· {l.city}</span>
              </span>
              <span className="truncate text-caption font-semibold text-[var(--color-content)]">
                <Price amount={headline.amount} currency={l.priceCurrency} /> / {headline.unit}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
