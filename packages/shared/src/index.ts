// AutoHire shared domain types.
// Consumed by /web now and /api later, so the data shapes stay in sync across the stack.
// All currency amounts are in RWF (Rwandan Franc) minor units? No — kept as whole RWF for clarity.

export type ID = string;

/** Individual personal-car owner vs. a registered fleet/business host (Section 3 of the blueprint). */
export type OwnerType = 'individual' | 'business';

/** Account roles. Verification + payout logic branch on these downstream. */
export type UserRole = 'renter' | 'owner' | 'admin';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

/** Documents collected during identity (renter) / vehicle (host) verification. */
export type VerificationDocType =
  | 'drivers_license'
  | 'national_id'
  | 'vehicle_registration'
  | 'insurance_certificate'
  | 'business_registration';

export interface VerificationDocument {
  id: ID;
  /** Owner of the document — the profile that uploaded it. */
  profileId: ID;
  type: VerificationDocType;
  status: VerificationStatus;
  fileName?: string;
  /** Path of the uploaded file in the private `kyc-documents` bucket. */
  storagePath?: string;
  uploadedAt?: string; // ISO
  /** Reviewer note, e.g. the reason a document was rejected. */
  note?: string;
  /** Admin who last actioned the document, and when. */
  reviewedBy?: ID;
  reviewedAt?: string; // ISO
  /** OCR / provider-extracted fields — populated by an automated KYC provider. */
  extracted?: Record<string, string>;
}

/** A verification document joined with its owner, for the admin review queue. */
export interface VerificationReviewItem extends VerificationDocument {
  owner: {
    id: ID;
    fullName: string;
    email: string;
    avatarUrl?: string;
    role: UserRole;
    ownerType?: OwnerType;
  };
}

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
  // Vehicles
  | 'sedan'
  | 'suv'
  | '4x4'
  | 'hatchback'
  | 'pickup'
  | 'van'
  | 'minibus'
  | 'luxury'
  // Cultivating (agricultural machinery)
  | 'tractor'
  | 'harvester'
  | 'tiller'
  // Building (construction machinery)
  | 'excavator'
  | 'bulldozer'
  | 'loader'
  | 'crane'
  | 'forklift';

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
  /**
   * Daily price, expressed in `priceCurrency`. (Named `…Rwf` for legacy reasons
   * — Rwanda was the only market — but the amount is now whatever `priceCurrency`
   * says; a Nairobi car holds KES, a Dubai car holds AED.)
   */
  pricePerDayRwf: number;
  /** ISO 4217 currency the car is priced + charged in. Defaults to 'RWF'. */
  priceCurrency: string;
  /** ISO 3166-1 alpha-2 market this car belongs to, e.g. 'RW', 'KE', 'AE'. */
  country: string;
  location: string; // e.g. "Kimihurura, Kigali"
  city: string; // e.g. "Kigali"
  photos: string[];
  features: string[];
  bookingMode: BookingMode;
  ratingAvg: number;
  ratingCount: number;
  /** ISO dates the owner has blocked for personal use / existing trips. */
  blockedDates: string[];
  /** Host-set availability. 'maintenance' means out of service. */
  status: ListingStatus;
  /** When `status` is 'maintenance', the day the car is back in service (ISO). */
  maintenanceUntil: string | null;
  /** Pickup point on the map; null until the host sets it. */
  lat: number | null;
  lng: number | null;
  /** Optional host-provided link for directions / arrival info. */
  locationUrl: string | null;
}

/** Host-set availability state. "Booked" is derived from bookings, not stored. */
export type ListingStatus = 'available' | 'maintenance';

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
  /** Payment state, owned server-side. A booking only exists once it is 'paid'. */
  paymentStatus: PaymentStatus;
  /** Stripe PaymentIntent that funded this booking (server-set, never trusted from the client). */
  paymentIntentId?: string;
  createdAt: string;
  checkIn?: CheckPhoto[];
  checkOut?: CheckPhoto[];
  /**
   * Two-sided handoff sign-offs. Pickup and return each need both the renter and
   * the host to confirm (with proof photos) before the trip advances.
   */
  pickupRenterAt?: string | null;
  pickupHostAt?: string | null;
  returnRenterAt?: string | null;
  returnHostAt?: string | null;
}

export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

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
  /** When the recipient read the message. Undefined = delivered but unread. */
  readAt?: string;
  /** Optional shared file/image. */
  attachmentUrl?: string | null;
  attachmentType?: string | null; // 'image' | 'file'
  attachmentName?: string | null;
  /** Id of the message this one quotes/replies to. */
  replyTo?: string | null;
  /** Emoji -> list of user ids who reacted. */
  reactions?: Record<string, string[]>;
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
  /** Recipient profile this notification belongs to. */
  profileId: ID;
  kind: NotificationKind;
  title: string;
  body: string;
  /** SMS is a primary channel in Rwanda, not an afterthought. */
  channels: NotificationChannel[];
  createdAt: string;
  read: boolean;
}

// ---------------------------------------------------------------------------
// Admin / moderation (A9).
// ---------------------------------------------------------------------------

export type FlagTargetType = 'listing' | 'user';
export type FlagReason = 'inappropriate' | 'spam' | 'fraud' | 'safety' | 'other';
export type ModerationStatus = 'open' | 'approved' | 'removed' | 'dismissed';

/** A user/listing reported for moderator review. */
export interface Flag {
  id: ID;
  targetType: FlagTargetType;
  targetId: ID;
  /** Denormalized name/title of the reported entity for display. */
  targetLabel: string;
  reason: FlagReason;
  detail: string;
  reportedBy: ID;
  createdAt: string;
  status: ModerationStatus;
}

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_renter'
  | 'resolved_host'
  | 'dismissed';

/** A damage/charge claim tied to a booking, resolved by an admin. */
export interface Dispute {
  id: ID;
  bookingId: ID;
  raisedBy: ID;
  against: ID;
  reason: string;
  /** Amount claimed, in RWF. */
  amountRwf: number;
  createdAt: string;
  status: DisputeStatus;
}

/** Platform-wide figures for the admin reporting view. */
export interface AdminStats {
  grossRwf: number;
  revenueRwf: number;
  payoutsPaidRwf: number;
  payoutsDueRwf: number;
  bookings: number;
  listings: number;
  hosts: number;
  openFlags: number;
  openDisputes: number;
}
