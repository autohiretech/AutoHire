import type { Host, Listing } from '@autohire/shared';
import {
  bookings,
  conversations,
  currentUser,
  hosts,
  listings,
  messages,
  notifications,
  payouts,
  reviews,
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

  // --- Bookings -----------------------------------------------------------
  listBookings() {
    return delay(bookings);
  },
  getBooking(id: string) {
    return delay(bookings.find((b) => b.id === id));
  },

  // --- Payouts ------------------------------------------------------------
  listPayouts() {
    return delay(payouts);
  },

  // --- Messaging ----------------------------------------------------------
  listConversations() {
    return delay(conversations);
  },
  listMessages(conversationId: string) {
    return delay(messages.filter((m) => m.conversationId === conversationId));
  },

  // --- Reviews ------------------------------------------------------------
  listReviews(subjectId?: string) {
    return delay(subjectId ? reviews.filter((r) => r.subjectId === subjectId) : reviews);
  },

  // --- Notifications ------------------------------------------------------
  listNotifications() {
    return delay(notifications);
  },

  // --- Current user -------------------------------------------------------
  getCurrentUser() {
    return delay(currentUser);
  },
};

export type MockClient = typeof mockClient;
