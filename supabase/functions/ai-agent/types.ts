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
  pricingMode: PricingMode;
  pricePerDayRwf: number | null;
  pricePerHourRwf: number | null;
  priceCurrency: string;
  ratingAvg?: number;
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
