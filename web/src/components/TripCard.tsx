import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { Booking, Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { TRIP_STATE_META } from '@/lib/trips';
import { Img } from '@/components/Img';
import { Badge, Card, CardBody } from '@/components/ui';

type Tone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const HINT_COLOR: Record<Tone, string> = {
  brand: 'text-brand-700',
  danger: 'text-red-600',
  warning: 'text-orange-700',
  neutral: 'text-ink-500',
  accent: 'text-amber-700',
  success: 'text-emerald-700',
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
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-600/40">
        <div className="flex">
          <Img
            src={listing?.photos[0]}
            alt={listing?.title ?? 'Car'}
            className="h-28 w-28 shrink-0 object-cover sm:h-32 sm:w-40"
          />
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 font-semibold text-ink-900">
                {listing?.title ?? 'Car'}
              </h3>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
              <CalendarDays size={15} />
              {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
              <span className="text-ink-400">· {booking.days} day{booking.days === 1 ? '' : 's'}</span>
            </p>
            <div className="mt-auto flex items-end justify-between gap-2 pt-3">
              <p className="font-semibold text-ink-900">{formatRwf(booking.totalRwf)}</p>
              {hint && (
                <span className={cn('inline-flex items-center gap-1 text-sm font-medium', HINT_COLOR[hint.tone])}>
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
