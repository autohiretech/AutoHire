import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { Booking, Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { TRIP_STATE_META } from '@/lib/trips';
import { Img } from '@/components/Img';
import { Badge, Card, CardBody } from '@/components/ui';

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
              <h3 className="line-clamp-1 font-semibold text-[var(--color-content)]">
                {listing?.title ?? 'Car'}
              </h3>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <p className="tabular mt-1 flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)]">
              <CalendarDays size={15} />
              {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
              <span className="text-[var(--color-content-subtle)]">
                · {booking.days} day{booking.days === 1 ? '' : 's'}
              </span>
            </p>
            <div className="mt-auto flex items-end justify-between gap-2 pt-3">
              <p className="tabular font-semibold text-[var(--color-content)]">{formatRwf(booking.totalRwf)}</p>
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
