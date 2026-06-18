import type {
  AdminStats,
  AppNotification,
  Booking,
  Conversation,
  Dispute,
  DisputeStatus,
  Flag,
  Host,
  Listing,
  Message,
  ModerationStatus,
  Payout,
  Review,
  UserProfile,
  VerificationDocType,
  VerificationDocument,
} from '@autohire/shared';
import {
  SERVICE_FEE_RATE,
  type CreateBookingInput,
  type CreateListingInput,
  type CreateReviewInput,
  type ListingFilters,
} from '@/lib/types';
import { getSupabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/identity';

/**
 * The Supabase-backed data client — the single implementation the app runs on.
 * `client.ts` re-exports it as `client` and derives the `Client` type from it.
 *
 * Identity comes from the logged-in Supabase session. Under "fresh signups
 * start empty" the acting user is one identity that backs both the renter and
 * host views, so `me()` drives renter_id and host_id alike.
 */
const me = () => getCurrentUserId();

const sb = () => getSupabase();

/** snake_case DB column -> camelCase domain key. */
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function mapRow<T>(row: Record<string, unknown> | null | undefined): T | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const ck = toCamel(k);
    // numeric(2,1) comes back as a string from PostgREST — coerce ratings to number.
    out[ck] = ck === 'ratingAvg' && typeof v === 'string' ? Number(v) : v;
  }
  return out as T;
}

function mapRows<T>(rows: Record<string, unknown>[] | null): T[] {
  return (rows ?? []).map((r) => mapRow<T>(r) as T);
}

/** Await a PostgREST builder, throwing on error and returning data. */
async function run<D>(builder: PromiseLike<{ data: D; error: { message: string } | null }>): Promise<D> {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

export const supabaseClient = {
  // --- Listings ----------------------------------------------------------
  async listListings(filters: ListingFilters = {}): Promise<Listing[]> {
    let q = sb().from('listings').select('*');
    if (filters.city) q = q.eq('city', filters.city);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.ownerType) q = q.eq('owner_type', filters.ownerType);
    if (filters.transmission) q = q.eq('transmission', filters.transmission);
    if (filters.minSeats) q = q.gte('seats', filters.minSeats);
    if (filters.maxPriceRwf) q = q.lte('price_per_day_rwf', filters.maxPriceRwf);
    if (filters.query) {
      const t = `%${filters.query}%`;
      q = q.or(`title.ilike.${t},make.ilike.${t},model.ilike.${t}`);
    }
    return mapRows<Listing>(await run(q));
  },
  async getListing(id: string) {
    return mapRow<Listing>(await run(sb().from('listings').select('*').eq('id', id).maybeSingle()));
  },
  async getHost(id: string) {
    return mapRow<Host>(await run(sb().from('profiles').select('*').eq('id', id).maybeSingle()));
  },
  async listHosts(): Promise<Host[]> {
    return mapRows<Host>(await run(sb().from('profiles').select('*').not('owner_type', 'is', null)));
  },

  // --- Bookings ----------------------------------------------------------
  async listBookings() {
    return mapRows<Booking>(
      await run(sb().from('bookings').select('*').order('created_at', { ascending: false })),
    );
  },
  async getBooking(id: string) {
    return mapRow<Booking>(await run(sb().from('bookings').select('*').eq('id', id).maybeSingle()));
  },
  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const listing = await run(
      sb().from('listings').select('price_per_day_rwf, host_id, booking_mode').eq('id', input.listingId).single(),
    );
    if (!listing) throw new Error(`Listing ${input.listingId} not found`);
    const days = diffDays(input.startDate, input.endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
    const row = await run(
      sb()
        .from('bookings')
        .insert({
          id: `bk-${Date.now()}`,
          listing_id: input.listingId,
          renter_id: me(),
          host_id: listing.host_id,
          start_date: input.startDate,
          end_date: input.endDate,
          days,
          state: listing.booking_mode === 'instant' ? 'confirmed' : 'requested',
          subtotal_rwf: subtotal,
          service_fee_rwf: serviceFee,
          total_rwf: subtotal + serviceFee,
          created_at: new Date().toISOString(),
        })
        .select('*')
        .single(),
    );
    return mapRow<Booking>(row) as Booking;
  },

  // --- Payouts -----------------------------------------------------------
  async listPayouts() {
    return mapRows<Payout>(await run(sb().from('payouts').select('*')));
  },

  // --- Owner dashboard ---------------------------------------------------
  async getCurrentHost() {
    return mapRow<Host>(
      await run(sb().from('profiles').select('*').eq('id', me()).maybeSingle()),
    );
  },
  async listOwnerListings() {
    return mapRows<Listing>(await run(sb().from('listings').select('*').eq('host_id', me())));
  },
  async listOwnerBookings() {
    return mapRows<Booking>(await run(sb().from('bookings').select('*').eq('host_id', me())));
  },
  async listOwnerPayouts() {
    return mapRows<Payout>(await run(sb().from('payouts').select('*').eq('host_id', me())));
  },
  async respondToBooking(id: string, action: 'approve' | 'decline') {
    const row = await run(
      sb()
        .from('bookings')
        .update({ state: action === 'approve' ? 'confirmed' : 'declined' })
        .eq('id', id)
        .select('*')
        .maybeSingle(),
    );
    return mapRow<Booking>(row);
  },
  async updateListing(id: string, patch: Partial<Pick<Listing, 'pricePerDayRwf' | 'blockedDates'>>) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.pricePerDayRwf !== undefined) dbPatch.price_per_day_rwf = patch.pricePerDayRwf;
    if (patch.blockedDates !== undefined) dbPatch.blocked_dates = patch.blockedDates;
    const row = await run(
      sb().from('listings').update(dbPatch).eq('id', id).select('*').maybeSingle(),
    );
    return mapRow<Listing>(row);
  },
  /**
   * Create a listing owned by the logged-in user. The first listing promotes the
   * profile to an individual host (owner_type / role / payout + insurance terms);
   * existing hosts keep their owner_type. vehicle_count is refreshed to match.
   */
  async createListing(input: CreateListingInput): Promise<Listing> {
    const hostId = me();
    const profile = await run(
      sb().from('profiles').select('owner_type').eq('id', hostId).single(),
    );
    const ownerType = ((profile?.owner_type as Listing['ownerType']) ?? 'individual');

    const row = await run(
      sb()
        .from('listings')
        .insert({
          id: `car-${Date.now()}`,
          title: input.title,
          host_id: hostId,
          owner_type: ownerType,
          category: input.category,
          make: input.make,
          model: input.model,
          year: input.year,
          seats: input.seats,
          transmission: input.transmission,
          fuel: input.fuel,
          price_per_day_rwf: input.pricePerDayRwf,
          location: input.location,
          city: input.city,
          photos: input.photos,
          features: input.features,
          booking_mode: input.bookingMode,
        })
        .select('*')
        .single(),
    );

    const { count } = await sb()
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('host_id', hostId);
    await run(
      sb()
        .from('profiles')
        .update({
          role: 'owner',
          owner_type: ownerType,
          payout_terms: 'per_trip',
          insurance_type: 'platform_provided',
          vehicle_count: count ?? 1,
        })
        .eq('id', hostId)
        .select('id'),
    );

    return mapRow<Listing>(row) as Listing;
  },

  // --- Messaging ---------------------------------------------------------
  async listConversations() {
    return mapRows<Conversation>(
      await run(sb().from('conversations').select('*').order('last_message_at', { ascending: false })),
    );
  },
  async getConversation(id: string) {
    return mapRow<Conversation>(
      await run(sb().from('conversations').select('*').eq('id', id).maybeSingle()),
    );
  },
  async listMessages(conversationId: string) {
    return mapRows<Message>(
      await run(
        sb().from('messages').select('*').eq('conversation_id', conversationId).order('sent_at'),
      ),
    );
  },
  async markConversationRead(conversationId: string): Promise<void> {
    await run(sb().from('conversations').update({ unread: 0 }).eq('id', conversationId).select('id'));
    await run(
      sb()
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', me())
        .is('read_at', null)
        .select('id'),
    );
  },
  async sendMessage(conversationId: string, body: string): Promise<Message> {
    const sentAt = new Date().toISOString();
    const row = await run(
      sb()
        .from('messages')
        .insert({
          id: `msg-${Date.now()}`,
          conversation_id: conversationId,
          sender_id: me(),
          body,
          sent_at: sentAt,
        })
        .select('*')
        .single(),
    );
    await run(
      sb()
        .from('conversations')
        .update({ last_message_preview: body, last_message_at: sentAt, unread: 0 })
        .eq('id', conversationId)
        .select('id'),
    );
    return mapRow<Message>(row) as Message;
  },

  // --- Reviews -----------------------------------------------------------
  async listReviews(subjectId?: string) {
    let q = sb().from('reviews').select('*');
    if (subjectId) q = q.eq('subject_id', subjectId);
    return mapRows<Review>(await run(q));
  },
  async listReviewsForBooking(bookingId: string) {
    return mapRows<Review>(await run(sb().from('reviews').select('*').eq('booking_id', bookingId)));
  },
  async createReview(input: CreateReviewInput): Promise<Review> {
    const booking = await run(
      sb().from('bookings').select('renter_id, host_id').eq('id', input.bookingId).single(),
    );
    if (!booking) throw new Error(`Booking ${input.bookingId} not found`);
    const toHost = input.direction === 'renter_to_host';
    const row = await run(
      sb()
        .from('reviews')
        .insert({
          id: `rv-${Date.now()}`,
          booking_id: input.bookingId,
          author_id: toHost ? booking.renter_id : booking.host_id,
          subject_id: toHost ? booking.host_id : booking.renter_id,
          direction: input.direction,
          rating: input.rating,
          body: input.body,
          created_at: new Date().toISOString(),
        })
        .select('*')
        .single(),
    );
    return mapRow<Review>(row) as Review;
  },

  // --- Notifications -----------------------------------------------------
  async listNotifications(): Promise<AppNotification[]> {
    return mapRows<AppNotification>(
      await run(
        sb()
          .from('notifications')
          .select('*')
          .eq('profile_id', me())
          .order('created_at', { ascending: false }),
      ),
    );
  },
  async markNotificationRead(id: string): Promise<void> {
    await run(sb().from('notifications').update({ read: true }).eq('id', id).select('id'));
  },
  async markAllNotificationsRead(): Promise<void> {
    await run(
      sb()
        .from('notifications')
        .update({ read: true })
        .eq('profile_id', me())
        .eq('read', false)
        .select('id'),
    );
  },

  // --- Verification ------------------------------------------------------
  async listVerificationDocuments(): Promise<VerificationDocument[]> {
    return mapRows<VerificationDocument>(
      await run(sb().from('verification_documents').select('*').eq('profile_id', me())),
    );
  },
  async uploadVerificationDocument(
    type: VerificationDocType,
    fileName: string,
  ): Promise<VerificationDocument> {
    const existing = await run(
      sb()
        .from('verification_documents')
        .select('id')
        .eq('profile_id', me())
        .eq('type', type)
        .maybeSingle(),
    );
    const fields = {
      profile_id: me(),
      type,
      status: 'pending' as const,
      file_name: fileName,
      uploaded_at: new Date().toISOString().slice(0, 10),
      note: null,
      extracted: null,
    };
    const row = existing
      ? await run(sb().from('verification_documents').update(fields).eq('id', existing.id).select('*').single())
      : await run(
          sb()
            .from('verification_documents')
            .insert({ id: `vd-${Date.now()}`, ...fields })
            .select('*')
            .single(),
        );
    return mapRow<VerificationDocument>(row) as VerificationDocument;
  },

  // --- Admin -------------------------------------------------------------
  async listFlags(): Promise<Flag[]> {
    return mapRows<Flag>(await run(sb().from('flags').select('*').order('created_at', { ascending: false })));
  },
  async resolveFlag(id: string, status: ModerationStatus) {
    const row = await run(sb().from('flags').update({ status }).eq('id', id).select('*').maybeSingle());
    return mapRow<Flag>(row);
  },
  async listDisputes(): Promise<Dispute[]> {
    return mapRows<Dispute>(
      await run(sb().from('disputes').select('*').order('created_at', { ascending: false })),
    );
  },
  async resolveDispute(id: string, status: DisputeStatus) {
    const row = await run(sb().from('disputes').update({ status }).eq('id', id).select('*').maybeSingle());
    return mapRow<Dispute>(row);
  },
  async getAdminStats(): Promise<AdminStats> {
    const [bookingRows, payoutRows, listings, hosts, flagsOpen, disputesOpen] = await Promise.all([
      run(sb().from('bookings').select('service_fee_rwf, total_rwf')),
      run(sb().from('payouts').select('amount_rwf, status')),
      sb().from('listings').select('id', { count: 'exact', head: true }),
      sb().from('profiles').select('id', { count: 'exact', head: true }).not('owner_type', 'is', null),
      sb().from('flags').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      sb().from('disputes').select('id', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
    ]);
    const sum = (rows: Record<string, unknown>[], key: string) =>
      rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
    const payouts = (payoutRows ?? []) as Record<string, unknown>[];
    const bookingsArr = (bookingRows ?? []) as Record<string, unknown>[];
    return {
      grossRwf: sum(bookingsArr, 'total_rwf'),
      revenueRwf: sum(bookingsArr, 'service_fee_rwf'),
      payoutsPaidRwf: sum(payouts.filter((p) => p.status === 'paid'), 'amount_rwf'),
      payoutsDueRwf: sum(payouts.filter((p) => p.status !== 'paid'), 'amount_rwf'),
      bookings: (bookingRows as unknown[]).length,
      listings: listings.count ?? 0,
      hosts: hosts.count ?? 0,
      openFlags: flagsOpen.count ?? 0,
      openDisputes: disputesOpen.count ?? 0,
    };
  },

  // --- Current user ------------------------------------------------------
  async getCurrentUser() {
    return mapRow<UserProfile>(
      await run(sb().from('profiles').select('*').eq('id', me()).maybeSingle()),
    ) as UserProfile;
  },
};
