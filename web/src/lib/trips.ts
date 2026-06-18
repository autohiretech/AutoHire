import type { TripState } from '@autohire/shared';

type BadgeTone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

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
