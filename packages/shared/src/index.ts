// AutoHire shared domain types.
// Consumed by /web now and /api later, so the data shapes stay in sync across the stack.
// All currency amounts are in RWF (Rwandan Franc) minor units? No — kept as whole RWF for clarity.

export type ID = string;

/** Individual personal-car owner vs. a registered fleet/business host (Section 3 of the blueprint). */
export type OwnerType = 'individual' | 'business';

/** Account roles. Verification + payout logic branch on these downstream. */
export type UserRole = 'renter' | 'owner' | 'admin';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface UserProfile {
  id: ID;
  fullName: string;
  avatarUrl?: string;
  email: string;
  phone: string; // Rwandan MSISDN, e.g. +2507...
  role: UserRole;
  joinedAt: string; // ISO date
  verification: VerificationStatus;
  ratingAvg?: number; // 0..5
  ratingCount?: number;
}

/** A host who lists vehicles. May be an individual or a business/fleet agency. */
export interface Host extends UserProfile {
  ownerType: OwnerType;
  /** Display name for a business host (e.g. "Kigali Car Rental Self Drive"). */
  businessName?: string;
  /** Per-trip payout for individuals; net-30 invoicing typical for business hosts. */
  payoutTerms: 'per_trip' | 'net_30';
  /** Fleet hosts usually carry commercial insurance; individuals use the platform product. */
  insuranceType: 'commercial' | 'platform_provided';
  vehicleCount: number;
}

export type CarCategory =
  | 'sedan'
  | 'suv'
  | '4x4'
  | 'hatchback'
  | 'pickup'
  | 'van'
  | 'minibus'
  | 'luxury';

export type Transmission = 'automatic' | 'manual';
export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'electric';

export type BookingMode = 'instant' | 'request';

export interface Listing {
  id: ID;
  title: string;
  hostId: ID;
  ownerType: OwnerType; // denormalized for fast filtering
  category: CarCategory;
  make: string;
  model: string;
  year: number;
  seats: number;
  transmission: Transmission;
  fuel: FuelType;
  /** Daily price in RWF. */
  pricePerDayRwf: number;
  location: string; // e.g. "Kimihurura, Kigali"
  city: string; // e.g. "Kigali"
  photos: string[];
  features: string[];
  bookingMode: BookingMode;
  ratingAvg: number;
  ratingCount: number;
  /** ISO dates the owner has blocked for personal use / existing trips. */
  blockedDates: string[];
}

export type TripState =
  | 'requested'
  | 'confirmed'
  | 'pickup'
  | 'active'
  | 'return'
  | 'completed'
  | 'cancelled'
  | 'declined';

export interface CheckPhoto {
  url: string;
  label: string; // e.g. "Front", "Odometer"
  takenAt: string;
}

export interface Booking {
  id: ID;
  listingId: ID;
  renterId: ID;
  hostId: ID;
  startDate: string; // ISO
  endDate: string; // ISO
  days: number;
  state: TripState;
  /** Money flow uses split rails: Stripe collects, payout via MoMo/Airtel/bank. */
  subtotalRwf: number;
  serviceFeeRwf: number;
  totalRwf: number;
  createdAt: string;
  checkIn?: CheckPhoto[];
  checkOut?: CheckPhoto[];
}

export type PayoutChannel = 'mtn_momo' | 'airtel_money' | 'bank_transfer';
export type PayoutStatus = 'scheduled' | 'processing' | 'paid' | 'failed';

export interface Payout {
  id: ID;
  bookingId: ID;
  hostId: ID;
  amountRwf: number;
  channel: PayoutChannel;
  status: PayoutStatus;
  scheduledFor: string;
  paidAt?: string;
}

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  body: string;
  sentAt: string;
}

export interface Conversation {
  id: ID;
  listingId: ID;
  renterId: ID;
  hostId: ID;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: number;
}

export type ReviewDirection = 'renter_to_host' | 'host_to_renter';

export interface Review {
  id: ID;
  bookingId: ID;
  authorId: ID;
  subjectId: ID;
  direction: ReviewDirection;
  rating: number; // 1..5
  body: string;
  createdAt: string;
}

export type NotificationChannel = 'sms' | 'push' | 'in_app';
export type NotificationKind =
  | 'booking_confirmation'
  | 'pickup_reminder'
  | 'return_reminder'
  | 'payout_alert'
  | 'message'
  | 'verification';

export interface AppNotification {
  id: ID;
  kind: NotificationKind;
  title: string;
  body: string;
  /** SMS is a primary channel in Rwanda, not an afterthought. */
  channels: NotificationChannel[];
  createdAt: string;
  read: boolean;
}
