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
  pricePerDayRwf: number;
  /** Currency the price is in; defaults to the host's country currency ('RWF'). */
  priceCurrency?: string;
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
