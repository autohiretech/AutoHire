// AutoHire — ai-agent shared types.
//
// Edge Functions here don't share a build with `web/` (no workspace import —
// see the other functions, none of them reach into `packages/shared` or
// `@/lib/types`), so anything from `ListingFilters` / `Listing` / `Booking`
// this function actually touches is redeclared here, trimmed to just the
// fields tools read or write. Source of truth for the full shapes is
// `web/src/lib/types.ts` and `packages/shared/src/index.ts` — keep in sync by
// hand, the same way `ai-search/index.ts` already keeps its own copy of
// `COUNTRY_CITIES`.

export type CarCategory = 'sedan' | 'suv' | '4x4' | 'hatchback' | 'pickup' | 'van' | 'minibus' | 'luxury';
export type OwnerType = 'individual' | 'business';
export type Transmission = 'automatic' | 'manual';
export type FuelType = 'petrol' | 'diesel' | 'electric' | 'hybrid';
export type PricingMode = 'daily' | 'hourly';
export type BookingMode = 'instant' | 'request';
export type ListingStatus = 'available' | 'maintenance' | 'unlisted';
export type UserRole = 'renter' | 'owner' | 'admin';
export type ReviewDirection = 'renter_to_host' | 'host_to_renter';

/** Mirrors `web/src/lib/types.ts` → ListingFilters exactly. */
export interface ListingFilters {
  country?: string;
  city?: string;
  category?: CarCategory;
  ownerType?: OwnerType;
  transmission?: Transmission;
  fuel?: FuelType;
  minSeats?: number;
  maxPriceRwf?: number;
  query?: string;
  /** Both required together. Real availability filtering — excludes any
   * listing with a conflicting booking (`search_available_listings`,
   * migration 074), not a hint the model interprets. */
  startDate?: string;
  endDate?: string;
  /** Both required together. Orders results by real haversine distance from
   * this point (migration 075). This is how "near me" is answered: a
   * coordinate through an algorithm in Postgres, never the model guessing
   * which city is close to which. */
  nearLat?: number;
  nearLng?: number;
}

/** The subset of `packages/shared` → Listing a tool result actually surfaces. */
export interface ListingSummary {
  id: string;
  title: string;
  category: CarCategory;
  make: string;
  model: string;
  city: string;
  country: string;
  seats: number;
  transmission: Transmission;
  fuel: FuelType;
  pricingMode: PricingMode;
  /** Despite the name, the car's OWN currency — a Nairobi car holds KES here.
   * Never compare or add two listings' prices without checking
   * `priceCurrency` first. */
  pricePerDayRwf: number | null;
  pricePerHourRwf: number | null;
  priceCurrency: string;
  ratingAvg?: number;
  ratingCount?: number;
  /** 'maintenance' means off the road, not booked. `maintenanceUntil` is the
   * day it comes back; null with that status means open-ended. */
  status: ListingStatus;
  maintenanceUntil?: string | null;
  /** Null for a host who never used the map picker — such a car has no pin on
   * the map, so don't promise the renter one. */
  lat?: number | null;
  lng?: number | null;
  hostId: string;
}

export interface BookingSummary {
  id: string;
  listingId: string;
  renterId: string;
  hostId: string;
  state: string;
  startDate: string;
  endDate: string;
  rentalType?: string;
  pickupTime?: string;
  paymentStatus?: string;
}
