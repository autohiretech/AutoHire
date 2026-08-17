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

/** Owner summary embedded in admin KYC views. */
export interface KycOwner {
  id: ID;
  fullName: string;
  email: string;
  avatarUrl?: string;
  role: UserRole;
  ownerType?: OwnerType;
}

/** A verification document joined with its owner, for the admin review queue. */
export interface VerificationReviewItem extends VerificationDocument {
  owner: KycOwner;
}

/** One entry in the KYC activity log. */
export type VerificationEventKind =
  | 'submitted'
  | 'resubmitted'
  | 'approved'
  | 'rejected'
  | 'override'
  | 'updated';

export interface VerificationEvent {
  id: number;
  /** Null for profile-level events such as an admin override. */
  documentId?: ID;
  profileId: ID;
  docType?: VerificationDocType;
  event: VerificationEventKind;
  status: VerificationStatus;
  actorId?: ID;
  note?: string;
  createdAt: string; // ISO
  /** Filled in by the client for display. */
  owner?: KycOwner;
  actorName?: string;
}

/** One person in the grouped KYC review queue, with document counts. */
export interface KycProfile extends KycOwner {
  verification: VerificationStatus;
  verificationOverride: boolean;
  pendingCount: number;
  docCount: number;
}

/** Aggregate KYC counts for the admin overview. */
export interface KycMetrics {
  pendingDocs: number;
  verifiedUsers: number;
  pendingUsers: number;
  rejectedUsers: number;
  unverifiedUsers: number;
  decisions7d: number;
}

/** A page of results plus the total match count, for scalable admin lists. */
export interface Page<T> {
  items: T[];
  total: number;
}

/** A user row in the admin user directory. */
export interface AdminUser {
  id: ID;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  ownerType?: OwnerType;
  verification: VerificationStatus;
  suspended: boolean;
  joinedAt?: string; // ISO date
  listingCount: number;
  bookingCount: number;
}

/** One recorded admin action taken on a user. */
export interface AdminAction {
  id: number;
  adminId?: ID;
  targetId: ID;
  action: string;
  detail?: string;
  createdAt: string; // ISO
  adminName?: string;
}

/** Platform electric-car quota snapshot (cars only; machinery is exempt). */
export interface ElectricQuota {
  minPercent: number;
  totalCars: number;
  electricCars: number;
  /** Whether a non-electric car may be listed right now without breaking the quota. */
  canAddNonElectric: boolean;
}

/**
 * Payout rails are an implementation detail — the host picks a *method* they
 * understand (mobile money / bank), and the system routes it to a provider.
 */
/**
 * The rail a booking's money moves on. 'external' is the external hold system
 * (it settles through Stripe on its own side); the other two are the direct
 * integrations it replaces, kept so existing bookings still capture and refund
 * against the rail that took their money.
 */
export type PayoutProvider = 'stripe' | 'flutterwave' | 'external' | 'payhold';
/**
 * What the host actually chose — the human-facing destination type.
 *
 * One entry per rail PayHold can tokenize a destination against (its
 * `PayoutProvider`), because a method that maps to no rail is a dead end the
 * host only discovers on submit. `momo` and `bank` cover Flutterwave's two;
 * `card` is Stripe Connect; the rest are the wallets, which are their own
 * rails rather than a flavour of card — PayPal and Alipay take an address, not
 * a number, and PayHold routes them separately.
 */
export type PayoutMethodType =
  | 'momo'
  | 'bank'
  | 'card'
  | 'paypal'
  | 'venmo'
  | 'cash_app'
  | 'alipay'
  | 'wechat_pay';
/** Onboarding state of a host's payout method. */
export type PayoutSetupStatus = 'none' | 'pending' | 'active';

/** How a renter pays — the mirror of PayoutMethodType on the paying side. */
export type PaymentMethodType =
  | 'card'
  | 'momo'
  | 'bank'
  | 'paypal'
  | 'alipay'
  | 'wechat_pay';
/** Onboarding state of a renter's saved payment method. */
export type PaymentSetupStatus = 'none' | 'pending' | 'active';

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
  /** Host payout method — how they get paid. Absent/`'none'` until they add one. */
  payoutMethod?: PayoutMethodType;
  /** The provider the method is routed to (chosen by the system, not the host). */
  payoutProvider?: PayoutProvider;
  payoutStatus?: PayoutSetupStatus;
  /** Masked destination, e.g. "••••1234". */
  payoutDestination?: string;
  /** Human-readable summary of the connected method, e.g. "MTN MoMo · ••••1234". */
  payoutLabel?: string;
  /**
   * Where this account pays from / is paid into (ISO 3166-1 alpha-2). Absent
   * means never asked — don't guess it from the browser's market selector.
   */
  country?: string;
  /** Renter payment method — how they pay. Absent/`'none'` until they add one. */
  paymentMethod?: PaymentMethodType;
  paymentStatus?: PaymentSetupStatus;
  /** Masked, e.g. "••••4242". The real credentials live with the provider. */
  paymentDestination?: string;
  /** Human-readable summary, e.g. "Card · ••••4242". */
  paymentLabel?: string;
  /** The external payment system's token for this method, once connected. */
  paymentRef?: string;
  /**
   * This host's PayHold seller record. Absent means their cars cannot be booked
   * on the PayHold rail — a deal names a seller.
   *
   * It cannot be backfilled. PayHold tokenizes the RAW destination, and AutoHire
   * only ever stored a mask, so every host has to enter their number once more.
   */
  payholdSellerId?: string;
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
   * A car is priced one way or the other, never both — pricingMode says
   * which. (Named `…Rwf` for legacy reasons — Rwanda was the only market —
   * but the amount is now whatever `priceCurrency` says; a Nairobi car holds
   * KES, a Dubai car holds AED.)
   */
  pricingMode: BookingRentalType;
  /** Set only when pricingMode is 'daily' — null for an hourly-only car. */
  pricePerDayRwf: number | null;
  /** ISO 4217 currency the car is priced + charged in. Defaults to 'RWF'. */
  priceCurrency: string;
  /**
   * The host's own per-hour rate. Suggested in the listing form as
   * pricePerDayRwf / 24 when switching modes, but stored explicitly and
   * host-editable. Set only when pricingMode is 'hourly' — null otherwise.
   * Also the base for the overage rate below.
   */
  pricePerHourRwf: number | null;
  /**
   * Late-return overage is billed at pricePerHourRwf × overageMultiplier —
   * "the host will choose the rate if it is price of hour times 2". Only
   * meaningful for a 'daily' car (an 'hourly' one already bills actual usage,
   * so there is no "late" to bill extra for). Set once, at listing time.
   * Defaults to 2.
   */
  overageMultiplier: number;
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

/** Whether a booking was priced by the calendar day or by actual hours used. */
export type BookingRentalType = 'daily' | 'hourly';

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
  /** Priced by the calendar day (existing behavior) or by actual hours used. */
  rentalType: BookingRentalType;
  /** Agreed pickup time-of-day. Naive — no timezone, same as start/end dates. */
  pickupTime?: string | null;
  /**
   * The agreed return time-of-day. For a daily booking this is what the
   * 2-hour late-return grace is measured against; for an hourly booking it is
   * pickupTime + estimatedHours, fixed at booking creation.
   */
  expectedReturnTime?: string | null;
  /** Hourly bookings only — the duration the renter chose at booking time. */
  estimatedHours?: number | null;
  /** Snapshot of the listing's rate(s) at booking time — immutable after. */
  pricePerHourRwf?: number | null;
  overageRateRwf?: number | null;
  /** What was actually funded up front — the full estimate for hourly, totalRwf for daily. */
  depositAmountRwf?: number | null;
  /** Written once, by settlement, when the trip reaches 'completed'. */
  actualHours?: number | null;
  finalAmountRwf?: number | null;
  /**
   * Still outstanding right now — a late daily return past its 2-hour grace,
   * or hourly usage beyond the deposit. Never collected automatically; the
   * host can lower this (mark it collected, or waive part of it) without it
   * ever going through PayHold, which is why it can drift below
   * amountExceededRwf.
   */
  amountOwedRwf: number;
  /**
   * The original amount it exceeded by, fixed once settlement computes it —
   * unlike amountOwedRwf, this never changes afterward, so "how much did
   * this exceed by" survives even after a host has resolved some or all of
   * it. Null until the trip is settled.
   */
  amountExceededRwf?: number | null;
  /**
   * PayHold's own automatic overage collection was refused — the renter paid
   * by a method with no reusable credential (mobile money, above all) — and
   * `payhold-webhook` flagged it here on `order.balance_charge_failed`. The
   * host collects it in person and clears the flag themselves; see
   * `acknowledgeOverageCollected`.
   */
  overageCollectionFailed?: boolean;
  overageCollectionFailedReason?: string | null;
  /** Payment state, owned server-side. A booking only exists once it is 'paid'. */
  paymentStatus: PaymentStatus;
  /** Rail that collected this booking — routed from the car's market. */
  provider?: PayoutProvider;
  /** Currency the renter was actually charged in (may differ from the car's price currency). */
  chargeCurrency?: string;
  /** Escrow state: funds are 'held' until the trip, then 'released' to the host. */
  holdStatus?: 'held' | 'released' | 'refunded';
  /** Provider payment reference (Stripe PaymentIntent / Flutterwave tx ref) — server-set. */
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
  /** Rail used to disburse — Flutterwave (MoMo/bank in Africa) or Stripe. */
  provider?: PayoutProvider;
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
  | 'verification'
  /** A watched car became bookable again. */
  | 'watchlist';

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
  /** In-app route this is about (e.g. `/cars/x`); absent = route by kind. */
  link?: string | null;
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

// ---------------------------------------------------------------------------
// PayHold
// ---------------------------------------------------------------------------
//
// The escrow platform that holds a renter's money and pays the host. AutoHire
// stores no balance of its own — these shapes are read live from PayHold, which
// owns the ledger.

/** Ledger money for one currency, as the renter was charged it. */
export interface PayholdBalance {
  currency: string;
  /** Money for trips still running — held, not yet earned. */
  held: number;
  /** Earned, inside the clearance window. Theirs, not yet payable. */
  pendingClearance: number;
  /** Cleared and payable. This is what a withdrawal moves. */
  available: number;
  reserved: number;
  paidOut: number;
}

/**
 * What a withdrawal would actually move, in the host's own payout currency —
 * a different question from `PayholdBalance`, and on a cross-border trip a
 * different number in a different currency.
 */
export interface PayholdWithdrawable {
  currency: string;
  availableAmount: number;
  availableCount: number;
  requestedAmount: number;
  requestedCount: number;
  clearingAmount: number;
  clearingCount: number;
  /** Counts against each reason something is not moving. */
  heldCount: number;
  needsVerificationCount: number;
  blockedCount: number;
  paidAmount: number;
  paidCount: number;
}

export interface PayholdWallet {
  /** Null until the host has registered a payout destination. */
  sellerId: string | null;
  balances: PayholdBalance[];
  withdrawable: PayholdWithdrawable[];
  canReceivePayouts: boolean;
  kycStatus: string;
  /** What the host must do — an identity check, a destination to verify. */
  reasons: string[];
  /** What PayHold cannot reach. Not the host's fault and not their fix. */
  routeReasons: string[];
}

/**
 * Where a trip's money is right now — the one word a host can act on.
 *
 * `awaiting_confirmation` is deliberately separate from `on_trip`: the money is
 * still held in both, but in the first it is waiting on a person, and that is
 * something the host can go and do something about.
 */
export type EarningStage =
  | 'awaiting_payment'
  | 'on_trip'
  | 'awaiting_confirmation'
  | 'clearing'
  | 'ready'
  | 'sending'
  | 'paid'
  | 'on_hold'
  | 'disputed'
  | 'refunded'
  | 'cancelled';

/** One trip's money, merged from AutoHire's booking and PayHold's ledger. */
export interface EarningTrip {
  bookingId: ID;
  dealId: string;
  car: string;
  photo: string | null;
  startDate: string;
  endDate: string;
  days: number;
  tripState: string;
  stage: EarningStage;
  dealStatus: string | null;
  currency: string;
  /** All amounts are MINOR units, as PayHold reports them. Null if unreachable. */
  gross: number | null;
  platformFee: number | null;
  providerFee: number | null;
  refunded: number | null;
  /** What the host actually earns on this trip. */
  net: number | null;
  /** When this money can be sent — the end of the clearance window. */
  availableAt: string | null;
  releasedAt: string | null;
  paidAt: string | null;
  holdReason: string | null;
  payoutStatus: string | null;
  rentalType: BookingRentalType;
  /**
   * AutoHire's own figure, in WHOLE units of `currency` — unlike gross/net/etc
   * above, this never came from PayHold and is never converted through
   * toMinorUnits/fromMinorUnits. More was owed than was collected (hourly
   * usage past the deposit, or a late daily return); never charged
   * automatically, only shown. Host-adjustable (lower only) — see
   * amountExceededRwf for the fixed original figure.
   */
  amountOwedRwf: number;
  /** The fixed original overage, before any host adjustment. Null if unsettled. */
  amountExceededRwf: number | null;
}

/** A place a host's money can be sent. */
export interface PayoutDestination {
  id: string;
  label: string | null;
  country: string;
  payoutCurrency: string;
  maskedDestination: string;
  isPrimary: boolean;
  isBackup: boolean;
  /** Null until PayHold verifies it — an unverified destination can't be paid. */
  verifiedAt: string | null;
  /** A newly added destination is frozen for a window against takeover. */
  securityHoldUntil: string | null;
}

/** Not `EarningsPage` — that name is the React route component. */
export interface HostEarnings {
  sellerId: string | null;
  trips: EarningTrip[];
  destinations: PayoutDestination[];
  hasMore: boolean;
}

/**
 * A host as PayHold knows them. A PayHold "seller" IS an AutoHire host — the
 * record that decides whether they can be paid at all.
 *
 * Money is not here on purpose: `PayholdWallet` answers "how much", this
 * answers "who am I to PayHold and can it reach me", and the two change on
 * completely different clocks.
 */
export interface PayholdSeller {
  /** Null until the host registers a payout destination. */
  sellerId: string | null;
  registered: boolean;
  host: { id: ID; name: string | null; country: string | null } | null;
  /** What AutoHire wrote down: a mask and a label, never the destination. */
  payout: {
    method: PayoutMethodType | null;
    maskedDestination: string | null;
    label: string | null;
    status: string | null;
  } | null;
  canReceivePayouts: boolean;
  kycStatus: string;
  /** What this host must go and do. */
  reasons: string[];
  /** What PayHold cannot reach — not the host's fault and not their fix. */
  routeReasons: string[];
  /** Null when PayHold was unreachable. `[]` means nowhere to be paid, which
   *  is a much more alarming thing to show than "we could not check". */
  destinations: PayoutDestination[] | null;
}

/**
 * An AutoHire dispute and the PayHold case behind it.
 *
 * `payholdDisputeId` is the load-bearing field: a case in PayHold's Resolution
 * Center FREEZES the payout on that deal. Null means this dispute is local
 * only and is holding nothing back — an older one, or one raised before PayHold
 * was switched on.
 */
export interface PayholdDispute extends Dispute {
  payholdDisputeId: string | null;
}

/**
 * What a refund request came back with. Note `dealStatus`, not "refunded":
 * PayHold answers when it ACCEPTS the refund, and the money landing is a later
 * event that arrives by webhook.
 */
export interface PayholdRefund {
  dealId: string;
  dealStatus: string;
  partial: boolean;
  /** Whole units of `currency`, or null for a full refund. */
  amount: number | null;
  currency: string;
  message: string;
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

// ----------------------------------------------------------------------------
// Social layer (migrations 058+). Every trip post is anchored to a paid,
// completed booking — enforced by trigger, not by this layer — so the whole
// point of these types is that they describe things the ledger already
// verified, not user-asserted claims.
// ----------------------------------------------------------------------------

/**
 * The PII-free profile projection (the `public_profiles` view, migration 029).
 * Every social surface — follower lists, feed authors, circle members — reads
 * this, never `UserProfile`, which since 029 is restricted to yourself, an
 * admin, or a booking/conversation counterparty.
 */
export interface PublicProfile {
  id: ID;
  fullName: string;
  avatarUrl?: string;
  role: UserRole;
  joinedAt: string; // ISO date
  verification: VerificationStatus;
  ratingAvg?: number;
  ratingCount?: number;
  ownerType?: OwnerType;
  businessName?: string;
}

/** Social proof shown on a car listing page — "Trusted by 3 friends". */
export interface SocialProof {
  listingId: ID;
  /** Accounts you follow who completed a paid trip on this exact car. */
  circleRenters: PublicProfile[];
  /** Total completed trips on this car, across everyone. */
  totalTrips: number;
}

export type CircleKind = 'crew' | 'cooperative' | 'team' | 'family';
export type CircleMemberStatus = 'invited' | 'active' | 'left';

export interface Circle {
  id: ID;
  name: string;
  kind: CircleKind;
  createdBy: ID;
  country?: string;
  createdAt: string; // ISO
  memberCount: number;
  /** The signed-in account's own membership, if any. */
  myStatus?: CircleMemberStatus;
}

export interface CircleMember {
  circleId: ID;
  profile: PublicProfile;
  role: 'owner' | 'member';
  status: CircleMemberStatus;
  joinedAt: string; // ISO
}

export interface Board {
  id: ID;
  title: string;
  createdBy: ID;
  circleId?: ID;
  isPublic: boolean;
  createdAt: string; // ISO
  itemCount: number;
}

export interface BoardItem {
  boardId: ID;
  listing: Listing;
  addedBy: PublicProfile;
  note?: string;
  /** Optional "we're thinking about these dates" — never required to pin a car. */
  targetStart?: string; // ISO date
  targetEnd?: string; // ISO date
  createdAt: string; // ISO
}

/** Forward-looking demand for a car on a given start date, from board pins. */
export interface ListingDemand {
  listingId: ID;
  targetStart: string; // ISO date
  interested: number;
}

/**
 * A share-link invite into a circle (migration 063). The token is the
 * credential — whoever holds the link and is signed in can claim it, once.
 * Phone/email matching against a brand-new signup is deferred (needs a
 * `profiles.phone` uniqueness backfill first), so this is link-only for now.
 */
export interface CircleInvite {
  id: ID;
  circleId: ID;
  invitedBy: ID;
  token: string;
  claimedBy?: ID;
  claimedAt?: string; // ISO
  createdAt: string; // ISO
}

export type PostVisibility = 'public' | 'circles' | 'private';

export interface TripPost {
  id: ID;
  author: PublicProfile;
  bookingId: string | null;
  listing: Pick<Listing, 'id' | 'title' | 'photos' | 'city' | 'country'> | null;
  body: string;
  photos: string[];
  visibility: PostVisibility;
  city?: string;
  country?: string;
  createdAt: string; // ISO
  /**
   * True for seeded launch content (`demo-post-%`, migration 065) — never a
   * real trip. Lets the feed label it honestly rather than presenting it as
   * an actual renter's experience.
   */
  isDemo?: boolean;
  /**
   * "Usually books: SUV" — computed from the author's own completed, paid
   * bookings (migration 069), never a self-declared field. Absent below a
   * 2-trip minimum, which is why every seeded post has none: nothing about a
   * demo account is a real trip, so there is nothing to compute from.
   */
  authorPreferredCategories?: CarCategory[];
}

export type CompanionStatus = 'invited' | 'joined' | 'declined';

/**
 * A named co-traveller on a trip. Carries no financial standing — the
 * organizer is the sole PayHold buyer and the sole liable driver, exactly as
 * migration 042 and the KYC pipeline already require. Never read by anything
 * that computes an amount.
 */
export interface BookingCompanion {
  id: ID;
  bookingId: ID;
  profile: PublicProfile | null;
  invitedName?: string;
  invitedEmail?: string;
  invitedPhone?: string;
  status: CompanionStatus;
  createdAt: string; // ISO
}

/**
 * An un-anchored fleet announcement (migration 067) — "15% off this weekend",
 * "new car added". Unlike TripPost, nothing here is verified by a booking;
 * it's just a host talking to whoever follows them. Never render this with
 * the trust language ("verified", a checkmark) a TripPost earns.
 */
export interface HostBroadcast {
  id: ID;
  host: PublicProfile;
  body: string;
  listing: Pick<Listing, 'id' | 'title' | 'photos'> | null;
  createdAt: string; // ISO
}

/** The feed merges TripPost and HostBroadcast into one chronological list. */
export type FeedItem =
  | ({ kind: 'trip' } & TripPost)
  | ({ kind: 'broadcast' } & HostBroadcast);
