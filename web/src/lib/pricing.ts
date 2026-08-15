import type { Listing } from '@autohire/shared';

/**
 * A listing is priced by the day OR by the hour, never both — this is the one
 * place that picks which number and which unit to show, so a screen never
 * shows a null/zero day price for an hourly-only car (or vice versa).
 */
export function listingHeadlinePrice(
  listing: Pick<Listing, 'pricingMode' | 'pricePerDayRwf' | 'pricePerHourRwf'>,
): { amount: number; unit: 'day' | 'hour' } {
  return listing.pricingMode === 'hourly'
    ? { amount: listing.pricePerHourRwf ?? 0, unit: 'hour' }
    : { amount: listing.pricePerDayRwf ?? 0, unit: 'day' };
}
