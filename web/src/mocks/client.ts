import type {
  AdminStats,
  Booking,
  Dispute,
  DisputeStatus,
  Flag,
  Host,
  Listing,
  Message,
  ModerationStatus,
  Payout,
  Review,
  ReviewDirection,
  VerificationDocType,
  VerificationDocument,
} from '@autohire/shared';
import {
  bookings,
  conversations,
  currentUser,
  disputes,
  flags,
  hosts,
  listings,
  messages,
  notifications,
  payouts,
  reviews,
  verificationDocuments,
} from './data';

/**
 * Mock API client.
 *
 * Every screen in Stage A reads through this — there are no real network calls.
 * Each method returns a Promise with simulated latency so loading states behave
 * realistically. When the backend lands (Stage B), this single module is swapped
 * for a real HTTP client with the same method signatures; screens don't change.
 */
const LATENCY_MS = 350;

/** Platform service fee applied on top of the rental subtotal. */
export const SERVICE_FEE_RATE = 0.1;

function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export interface ListingFilters {
  city?: string;
  category?: Listing['category'];
  ownerType?: Listing['ownerType'];
  transmission?: Listing['transmission'];
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

/**
 * The host account represented by the owner dashboard in Stage A — a
 * business/fleet host so the dashboard demos multiple listings, an incoming
 * request queue, and payouts. Stage B derives this from the logged-in user.
 */
export const CURRENT_HOST_ID = 'host-3';

export const mockClient = {
  // --- Listings -----------------------------------------------------------
  listListings(filters: ListingFilters = {}): Promise<Listing[]> {
    let result = [...listings];
    if (filters.city) result = result.filter((l) => l.city === filters.city);
    if (filters.category) result = result.filter((l) => l.category === filters.category);
    if (filters.ownerType) result = result.filter((l) => l.ownerType === filters.ownerType);
    if (filters.transmission)
      result = result.filter((l) => l.transmission === filters.transmission);
    if (filters.minSeats) result = result.filter((l) => l.seats >= filters.minSeats!);
    if (filters.maxPriceRwf)
      result = result.filter((l) => l.pricePerDayRwf <= filters.maxPriceRwf!);
    if (filters.query) {
      const q = filters.query.toLowerCase();
      result = result.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.make.toLowerCase().includes(q) ||
          l.model.toLowerCase().includes(q),
      );
    }
    return delay(result);
  },

  getListing(id: string): Promise<Listing | undefined> {
    return delay(listings.find((l) => l.id === id));
  },

  getHost(id: string): Promise<Host | undefined> {
    return delay(hosts.find((h) => h.id === id));
  },
  listHosts(): Promise<Host[]> {
    return delay(hosts);
  },

  // --- Bookings -----------------------------------------------------------
  listBookings() {
    return delay(bookings);
  },
  getBooking(id: string) {
    return delay(bookings.find((b) => b.id === id));
  },
  /**
   * Create a booking from a listing + date range. Computes pricing (subtotal +
   * 10% service fee) and prepends it to the in-memory list so it shows up in
   * "My trips". Instant-book listings land `confirmed`; request-to-book ones
   * land `requested` (awaiting host approval). Stage B replaces this with a POST.
   */
  createBooking(input: CreateBookingInput): Promise<Booking> {
    const listing = listings.find((l) => l.id === input.listingId);
    if (!listing) return Promise.reject(new Error(`Unknown listing ${input.listingId}`));

    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const subtotalRwf = listing.pricePerDayRwf * days;
    const serviceFeeRwf = Math.round(subtotalRwf * SERVICE_FEE_RATE);

    const booking: Booking = {
      id: `bk-${Date.now()}`,
      listingId: listing.id,
      renterId: currentUser.id,
      hostId: listing.hostId,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
      state: listing.bookingMode === 'instant' ? 'confirmed' : 'requested',
      subtotalRwf,
      serviceFeeRwf,
      totalRwf: subtotalRwf + serviceFeeRwf,
      createdAt: new Date().toISOString(),
    };
    bookings.unshift(booking);
    return delay(booking);
  },

  // --- Payouts ------------------------------------------------------------
  listPayouts() {
    return delay(payouts);
  },

  // --- Owner dashboard (host-scoped) --------------------------------------
  getCurrentHost(): Promise<Host | undefined> {
    return delay(hosts.find((h) => h.id === CURRENT_HOST_ID));
  },
  listOwnerListings(): Promise<Listing[]> {
    return delay(listings.filter((l) => l.hostId === CURRENT_HOST_ID));
  },
  listOwnerBookings(): Promise<Booking[]> {
    return delay(bookings.filter((b) => b.hostId === CURRENT_HOST_ID));
  },
  listOwnerPayouts(): Promise<Payout[]> {
    return delay(payouts.filter((p) => p.hostId === CURRENT_HOST_ID));
  },
  /** Approve or decline a pending booking request. */
  respondToBooking(id: string, action: 'approve' | 'decline'): Promise<Booking | undefined> {
    const booking = bookings.find((b) => b.id === id);
    if (booking) booking.state = action === 'approve' ? 'confirmed' : 'declined';
    return delay(booking);
  },
  /** Update owner-editable listing fields (price, blocked/personal-use dates). */
  updateListing(
    id: string,
    patch: Partial<Pick<Listing, 'pricePerDayRwf' | 'blockedDates'>>,
  ): Promise<Listing | undefined> {
    const listing = listings.find((l) => l.id === id);
    if (listing) Object.assign(listing, patch);
    return delay(listing);
  },

  // --- Messaging ----------------------------------------------------------
  listConversations() {
    return delay(conversations);
  },
  getConversation(id: string) {
    return delay(conversations.find((c) => c.id === id));
  },
  listMessages(conversationId: string) {
    return delay(messages.filter((m) => m.conversationId === conversationId));
  },
  /** Mark a conversation's incoming messages as read (clears the unread badge). */
  markConversationRead(conversationId: string): Promise<void> {
    const conversation = conversations.find((c) => c.id === conversationId);
    if (conversation) conversation.unread = 0;
    const now = new Date().toISOString();
    for (const m of messages) {
      if (m.conversationId === conversationId && m.senderId !== currentUser.id && !m.readAt) {
        m.readAt = now;
      }
    }
    return delay(undefined);
  },
  /** Send a message as the current user; updates the conversation preview. */
  sendMessage(conversationId: string, body: string): Promise<Message> {
    const message: Message = {
      id: `msg-${Date.now()}`,
      conversationId,
      senderId: currentUser.id,
      body,
      sentAt: new Date().toISOString(),
    };
    messages.push(message);
    const conversation = conversations.find((c) => c.id === conversationId);
    if (conversation) {
      conversation.lastMessagePreview = body;
      conversation.lastMessageAt = message.sentAt;
      conversation.unread = 0;
    }
    return delay(message);
  },

  // --- Reviews ------------------------------------------------------------
  listReviews(subjectId?: string) {
    return delay(subjectId ? reviews.filter((r) => r.subjectId === subjectId) : reviews);
  },
  listReviewsForBooking(bookingId: string): Promise<Review[]> {
    return delay(reviews.filter((r) => r.bookingId === bookingId));
  },
  /** Submit a two-way review; author/subject are derived from the booking. */
  createReview(input: CreateReviewInput): Promise<Review> {
    const booking = bookings.find((b) => b.id === input.bookingId);
    if (!booking) return Promise.reject(new Error(`Unknown booking ${input.bookingId}`));
    const toHost = input.direction === 'renter_to_host';
    const review: Review = {
      id: `rv-${Date.now()}`,
      bookingId: input.bookingId,
      authorId: toHost ? booking.renterId : booking.hostId,
      subjectId: toHost ? booking.hostId : booking.renterId,
      direction: input.direction,
      rating: input.rating,
      body: input.body,
      createdAt: new Date().toISOString(),
    };
    reviews.push(review);
    return delay(review);
  },

  // --- Notifications ------------------------------------------------------
  listNotifications() {
    return delay(notifications);
  },
  markNotificationRead(id: string): Promise<void> {
    const n = notifications.find((x) => x.id === id);
    if (n) n.read = true;
    return delay(undefined);
  },
  markAllNotificationsRead(): Promise<void> {
    for (const n of notifications) n.read = true;
    return delay(undefined);
  },

  // --- Verification -------------------------------------------------------
  listVerificationDocuments(): Promise<VerificationDocument[]> {
    return delay(verificationDocuments);
  },
  /**
   * Upload (or replace) a verification document. Lands in `pending` review;
   * Stage C wires real OCR + a reviewer workflow. Returns the document.
   */
  uploadVerificationDocument(type: VerificationDocType, fileName: string): Promise<VerificationDocument> {
    let doc = verificationDocuments.find((d) => d.type === type);
    if (doc) {
      doc.status = 'pending';
      doc.fileName = fileName;
      doc.uploadedAt = new Date().toISOString();
      doc.note = undefined;
      doc.extracted = undefined;
    } else {
      doc = {
        id: `vd-${Date.now()}`,
        type,
        status: 'pending',
        fileName,
        uploadedAt: new Date().toISOString(),
      };
      verificationDocuments.push(doc);
    }
    return delay(doc);
  },

  // --- Admin --------------------------------------------------------------
  listFlags(): Promise<Flag[]> {
    return delay(flags);
  },
  resolveFlag(id: string, status: ModerationStatus): Promise<Flag | undefined> {
    const flag = flags.find((f) => f.id === id);
    if (flag) flag.status = status;
    return delay(flag);
  },
  listDisputes(): Promise<Dispute[]> {
    return delay(disputes);
  },
  resolveDispute(id: string, status: DisputeStatus): Promise<Dispute | undefined> {
    const dispute = disputes.find((d) => d.id === id);
    if (dispute) dispute.status = status;
    return delay(dispute);
  },
  getAdminStats(): Promise<AdminStats> {
    const revenueRwf = bookings.reduce((sum, b) => sum + b.serviceFeeRwf, 0);
    const grossRwf = bookings.reduce((sum, b) => sum + b.totalRwf, 0);
    const payoutsPaidRwf = payouts
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + p.amountRwf, 0);
    const payoutsDueRwf = payouts
      .filter((p) => p.status !== 'paid')
      .reduce((sum, p) => sum + p.amountRwf, 0);
    return delay({
      grossRwf,
      revenueRwf,
      payoutsPaidRwf,
      payoutsDueRwf,
      bookings: bookings.length,
      listings: listings.length,
      hosts: hosts.length,
      openFlags: flags.filter((f) => f.status === 'open').length,
      openDisputes: disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length,
    });
  },

  // --- Current user -------------------------------------------------------
  getCurrentUser() {
    return delay(currentUser);
  },
};

export type MockClient = typeof mockClient;
