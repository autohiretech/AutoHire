import type { Listing, ReviewDirection } from '@autohire/shared';

/**
 * Data-access contracts shared by the client and the screens that call it.
 * (Previously these lived alongside the mock client; they now stand on their
 * own since the app is Supabase-only.)
 */

/** Platform service fee applied on top of the rental subtotal. */
export const SERVICE_FEE_RATE = 0.1;

export interface ListingFilters {
  /** ISO 3166-1 alpha-2 market, e.g. 'RW'. Set from the header country selector. */
  country?: string;
  city?: string;
  category?: Listing['category'];
  ownerType?: Listing['ownerType'];
  transmission?: Listing['transmission'];
  /** Fuel/power type, e.g. 'electric' for the electric-only filter. */
  fuel?: Listing['fuel'];
  /** Minimum seat count (e.g. 7 for "7+ seats"). */
  minSeats?: number;
  maxPriceRwf?: number;
  query?: string;
}

export interface CreateBookingInput {
  listingId: string;
  startDate: string; // ISO date (yyyy-mm-dd)
  endDate: string; // ISO date (yyyy-mm-dd)
}

export interface CreateReviewInput {
  bookingId: string;
  direction: ReviewDirection;
  rating: number; // 1..5
  body: string;
}

export interface CreateListingInput {
  title: string;
  category: Listing['category'];
  make: string;
  model: string;
  year: number;
  seats: number;
  transmission: Listing['transmission'];
  fuel: Listing['fuel'];
  /** A car is priced one way or the other — never both. */
  pricingMode: Listing['pricingMode'];
  /** Required when pricingMode is 'daily'; omit/null for an hourly-only car. */
  pricePerDayRwf: number | null;
  /** Currency the price is in; defaults to the host's country currency ('RWF'). */
  priceCurrency?: string;
  /** Required when pricingMode is 'hourly'; omit/null for a daily-only car. */
  pricePerHourRwf?: number | null;
  /** Late-return overage multiplier on pricePerHourRwf. Only used in 'daily' mode. Defaults to 2. */
  overageMultiplier?: number;
  /** ISO country the car sits in; defaults to the host's country ('RW'). */
  country?: string;
  location: string;
  city: string;
  photos: string[];
  features: string[];
  bookingMode: Listing['bookingMode'];
  /** Availability status; defaults to 'available' when omitted. */
  status?: Listing['status'];
  /** Back-in-service date when status is 'maintenance' (ISO date). */
  maintenanceUntil?: string | null;
  /** Pickup map coordinates (optional). */
  lat?: number | null;
  lng?: number | null;
  /** Optional host-provided directions / arrival link. */
  locationUrl?: string | null;
}
