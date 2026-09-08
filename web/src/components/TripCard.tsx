import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { Booking, Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { TRIP_STATE_META } from '@/lib/trips';
import { Img } from '@/components/Img';
import { Badge, Card, CardBody, Skeleton } from '@/components/ui';

type Tone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** Hint-line colour per tone. `brand`/`success` share the accent — this app
    has no separate "positive" hue (see index.css); the rest are genuine
    states, mapped to the semantic tokens. */
const HINT_COLOR: Record<Tone, string> = {
  brand: 'text-[var(--color-accent-on)]',
  danger: 'text-[var(--color-danger-500)]',
  warning: 'text-[var(--color-warn-500)]',
  neutral: 'text-[var(--color-content-muted)]',
  accent: 'text-[var(--color-warn-500)]',
  success: 'text-[var(--color-accent-on)]',
};

/**
 * A single trip in the "My trips" list. Links to the trip detail page. An
 * optional `hint` surfaces the viewer's next step (e.g. host "Confirm pickup").
 */
export function TripCard({
  booking,
  listing,
  hint,
}: {
  booking: Booking;
  listing?: Listing;
  hint?: { label: string; tone: Tone } | null;
}) {
  const state = TRIP_STATE_META[booking.state];

  return (
    <Link to={`/trips/${booking.id}`} className="group block focus:outline-none">
      <Card
        interactive
        className="overflow-hidden group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-accent-on)]/40"
      >
        <div className="flex">
          <Img
            src={listing?.photos[0]}
            alt={listing?.title ?? 'Car'}
            className="h-28 w-28 shrink-0 object-cover sm:h-32 sm:w-40"
          />
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 text-body-sm font-medium text-[var(--color-content)] sm:text-body sm:font-semibold">
                {listing?.title ?? 'Car'}
              </h3>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <p className="tabular mt-1 flex items-center gap-1.5 text-caption text-[var(--color-content-muted)] sm:text-body-sm">
              <CalendarDays size={15} />
              {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
              <span className="text-[var(--color-content-subtle)]">
                · {booking.days} day{booking.days === 1 ? '' : 's'}
              </span>
            </p>
            <div className="mt-auto flex items-end justify-between gap-2 pt-3">
              <p className="tabular text-body-sm font-semibold text-[var(--color-content)] sm:text-body">{formatRwf(booking.totalRwf)}</p>
              {hint && (
                <span className={cn('inline-flex items-center gap-1 text-body-sm font-medium', HINT_COLOR[hint.tone])}>
                  {hint.label} <ArrowRight size={14} />
                </span>
              )}
            </div>
          </CardBody>
        </div>
      </Card>
    </Link>
  );
}

/** Loading placeholder for `TripCard` — same thumbnail, title, badge, date
    and price positions, so a list of these doesn't reflow once trips load. */
export function TripCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <Skeleton className="h-28 w-28 shrink-0 rounded-none sm:h-32 sm:w-40" />
        <CardBody className="flex flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-5 w-16 rounded-[var(--radius-pill)]" />
          </div>
          <Skeleton className="mt-2 h-4 w-3/5" />
          <div className="mt-auto flex items-end justify-between gap-2 pt-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        </CardBody>
      </div>
    </Card>
  );
}
