import type { Booking, TripState } from '@autohire/shared';

type BadgeTone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * The host's next step on a live trip, from the booking's handoff timestamps —
 * used to surface a "what to do next" hint instead of just a status badge.
 * Returns null when the ball is not in the host's court.
 */
export function hostTripHint(b: Booking): { label: string; tone: BadgeTone } | null {
  const overdue = ['confirmed', 'pickup', 'active', 'return'].includes(b.state) && b.endDate < todayISO();
  if (b.state === 'confirmed' || b.state === 'pickup') {
    if (!b.pickupHostAt) return { label: 'Confirm pickup', tone: 'brand' };
    if (!b.pickupRenterAt) return { label: 'Waiting on renter to confirm pickup', tone: 'neutral' };
    return null;
  }
  if (b.state === 'active' || b.state === 'return') {
    if (overdue && !b.returnHostAt) return { label: 'Overdue — confirm return', tone: 'danger' };
    if (b.state === 'return' && !b.returnHostAt) return { label: 'Confirm return', tone: 'brand' };
    if (overdue) return { label: 'Return overdue', tone: 'danger' };
    return null;
  }
  return null;
}

/** Display label + badge tone for each trip state. */
export const TRIP_STATE_META: Record<TripState, { label: string; tone: BadgeTone }> = {
  requested: { label: 'Requested', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  pickup: { label: 'Ready for pickup', tone: 'brand' },
  active: { label: 'On trip', tone: 'brand' },
  return: { label: 'Returning', tone: 'brand' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  declined: { label: 'Declined', tone: 'danger' },
};

/** The happy-path lifecycle, in order — drives the trip-detail timeline. */
export const TRIP_TIMELINE: TripState[] = [
  'requested',
  'confirmed',
  'pickup',
  'active',
  'return',
  'completed',
];

interface TripGroup {
  key: string;
  title: string;
  states: TripState[];
}

/** Sections for the "My trips" list, in display order. */
export const TRIP_GROUPS: TripGroup[] = [
  { key: 'upcoming', title: 'Upcoming', states: ['requested', 'confirmed', 'pickup'] },
  { key: 'active', title: 'Active', states: ['active', 'return'] },
  { key: 'past', title: 'Completed & past', states: ['completed', 'cancelled', 'declined'] },
];
