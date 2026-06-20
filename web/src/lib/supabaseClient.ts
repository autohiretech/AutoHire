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
  /**
   * AI Mode search: send a natural-language query to the `ai-search` Edge
   * Function, which uses Claude (server-side) to turn it into ListingFilters.
   * Returns the filters so the caller runs the normal `listListings` query.
   * Throws a friendly message when the function isn't deployed or AI isn't
   * configured, so the UI can fall back to plain keyword search.
   */
  async aiSearch(query: string): Promise<ListingFilters> {
    const { data, error } = await getSupabase().functions.invoke('ai-search', {
      body: { query },
    });
    if (error) {
      throw new Error(
        error.name === 'FunctionsFetchError'
          ? "AI search isn't deployed yet — deploy the ai-search Edge Function."
          : error.message,
      );
    }
    const payload = data as { filters?: ListingFilters; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload?.filters ?? {};
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
  /**
   * Finalise a booking. There is no client-side insert: the `confirm-booking`
   * Edge Function recomputes the amounts and writes the row with the service
   * role, so the renter can't set their own price, days or status.
   *
   * In live mode it verifies the Stripe PaymentIntent (pass `paymentIntentId`).
   * In demo mode (no Stripe configured) it confirms instantly from the listing +
   * dates — no real charge. listingId/startDate/endDate are sent for both.
   */
  async confirmBooking(input: {
    listingId: string;
    startDate: string;
    endDate: string;
    paymentIntentId?: string;
  }): Promise<Booking> {
    // Demo mode (no Stripe key) — skip the Edge Function entirely and create the
    // booking straight from the browser. No real charge, no function deploy.
    // The DB triggers (availability + status lock) still enforce the rules.
    if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) {
      const renterId = me();
      const listing = await run(
        sb()
          .from('listings')
          .select('price_per_day_rwf, host_id, booking_mode')
          .eq('id', input.listingId)
          .single(),
      );
      if (!listing) throw new Error('Listing not found.');
      if (listing.host_id === renterId) {
        throw new Error('You cannot book your own car.');
      }
      const days = Math.max(
        1,
        Math.round(
          (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) / 86_400_000,
        ),
      );
      const subtotal = (listing.price_per_day_rwf as number) * days;
      const serviceFee = Math.round(subtotal * 0.1);
      const row = await run(
        sb()
          .from('bookings')
          .insert({
            id: `bk-${Date.now()}`,
            listing_id: input.listingId,
            renter_id: renterId,
            host_id: listing.host_id,
            start_date: input.startDate,
            end_date: input.endDate,
            days,
            state: listing.booking_mode === 'instant' ? 'confirmed' : 'requested',
            subtotal_rwf: subtotal,
            service_fee_rwf: serviceFee,
            total_rwf: subtotal + serviceFee,
            payment_status: 'paid',
            payment_intent_id: `demo-${Date.now()}`,
            created_at: new Date().toISOString(),
          })
          .select('*')
          .single(),
      );
      return mapRow<Booking>(row) as Booking;
    }

    const { data, error } = await getSupabase().functions.invoke('confirm-booking', {
      body: input,
    });
    if (error) {
      throw new Error(
        error.name === 'FunctionsFetchError'
          ? "Bookings aren't deployed yet — deploy the confirm-booking Edge Function."
          : error.message,
      );
    }
    const payload = data as { booking?: Booking; error?: string };
    if (payload?.error || !payload?.booking) {
      throw new Error(payload?.error ?? 'Could not confirm the booking.');
    }
    return payload.booking;
  },

  /**
   * Confirm one side of a handoff (pickup or return) with proof photos. The
   * server stamps the caller's slot and only advances the trip (→ active /
   * → completed) once BOTH the renter and host have signed off.
   */
  async confirmHandoff(
    bookingId: string,
    phase: 'pickup' | 'return',
    photoUrls: string[],
  ): Promise<Booking> {
    const takenAt = new Date().toISOString();
    const photos = photoUrls.map((url) => ({
      url,
      label: phase === 'pickup' ? 'Pickup' : 'Return',
      takenAt,
    }));
    const row = await run(
      getSupabase().rpc('confirm_handoff', {
        p_booking_id: bookingId,
        p_phase: phase,
        p_photos: photos,
      }),
    );
    return mapRow<Booking>(row as Record<string, unknown>) as Booking;
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
  /** Create any pending "overdue return" notifications for my trips (idempotent). */
  async checkOverdueReturns(): Promise<void> {
    await run(getSupabase().rpc('notify_overdue_returns'));
  },
  async listOwnerPayouts() {
    return mapRows<Payout>(await run(sb().from('payouts').select('*').eq('host_id', me())));
  },
  async respondToBooking(id: string, action: 'approve' | 'decline') {
    // Declining a paid request refunds it in the same update.
    const patch =
      action === 'approve'
        ? { state: 'confirmed' }
        : { state: 'declined', payment_status: 'refunded' };
    const row = await run(sb().from('bookings').update(patch).eq('id', id).select('*').maybeSingle());
    return mapRow<Booking>(row);
  },
  /** Cancel a booking and refund it (host: confirmed/pickup; renter: requested/confirmed). */
  async cancelBooking(id: string): Promise<Booking> {
    const row = await run(
      sb()
        .from('bookings')
        .update({ state: 'cancelled', payment_status: 'refunded' })
        .eq('id', id)
        .select('*')
        .single(),
    );
    return mapRow<Booking>(row) as Booking;
  },
  /** A single profile by id (renter or host). */
  async getProfile(id: string): Promise<(UserProfile & Partial<Host>) | undefined> {
    return mapRow<UserProfile & Partial<Host>>(
      await run(sb().from('profiles').select('*').eq('id', id).maybeSingle()),
    );
  },
  /** Verification documents for a profile (host can read a requester's via RLS). */
  async listVerificationDocumentsFor(profileId: string): Promise<VerificationDocument[]> {
    return mapRows<VerificationDocument>(
      await run(sb().from('verification_documents').select('*').eq('profile_id', profileId)),
    );
  },
  async updateListing(
    id: string,
    patch: Partial<
      Pick<
        Listing,
        | 'title'
        | 'category'
        | 'make'
        | 'model'
        | 'year'
        | 'seats'
        | 'transmission'
        | 'fuel'
        | 'pricePerDayRwf'
        | 'location'
        | 'city'
        | 'photos'
        | 'features'
        | 'bookingMode'
        | 'blockedDates'
        | 'status'
        | 'maintenanceUntil'
        | 'lat'
        | 'lng'
        | 'locationUrl'
      >
    >,
  ) {
    const map: Record<string, string> = {
      title: 'title',
      category: 'category',
      make: 'make',
      model: 'model',
      year: 'year',
      seats: 'seats',
      transmission: 'transmission',
      fuel: 'fuel',
      pricePerDayRwf: 'price_per_day_rwf',
      location: 'location',
      city: 'city',
      photos: 'photos',
      features: 'features',
      bookingMode: 'booking_mode',
      blockedDates: 'blocked_dates',
      maintenanceUntil: 'maintenance_until',
      lat: 'lat',
      lng: 'lng',
      locationUrl: 'location_url',
    };
    const dbPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === 'status') {
        dbPatch.status = v;
        if (v === 'available') dbPatch.maintenance_until = null; // leaving maintenance clears the date
      } else if (map[k]) {
        dbPatch[map[k]] = v;
      }
    }
    const row = await run(
      sb().from('listings').update(dbPatch).eq('id', id).select('*').maybeSingle(),
    );
    return mapRow<Listing>(row);
  },
  /**
   * Booked (unavailable) date ranges for a listing — start/end of every live
   * booking, with no renter identity or amounts. Backed by a SECURITY DEFINER
   * function so it works for browsing renters too, not just the host.
   */
  async getBookedRanges(listingId: string): Promise<{ startDate: string; endDate: string }[]> {
    const rows = await run(
      sb().rpc('listing_booked_ranges', { p_listing_id: listingId }),
    );
    return ((rows as { start_date: string; end_date: string }[]) ?? []).map((r) => ({
      startDate: r.start_date,
      endDate: r.end_date,
    }));
  },
  /**
   * Upload car photos to Supabase Storage and return their public URLs. Files
   * are stored under the uploader's folder in the public `car-photos` bucket;
   * the returned URLs are what gets saved in `listings.photos`.
   */
  async uploadPhotos(files: File[]): Promise<string[]> {
    const userId = me();
    const urls: string[] = [];
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await sb()
        .storage.from('car-photos')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
      if (error) throw new Error(error.message);
      urls.push(sb().storage.from('car-photos').getPublicUrl(path).data.publicUrl);
    }
    return urls;
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
          status: input.status ?? 'available',
          maintenance_until: input.status === 'maintenance' ? input.maintenanceUntil || null : null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          location_url: input.locationUrl || null,
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
  /**
   * Find the renter↔host thread for a listing, or start one. Either participant
   * may call it (RLS lets you create a row you're part of), so it powers the
   * car-page "Message host", the booking auto-text, and the trip "Message" button
   * for both sides.
   */
  async getOrCreateConversation(
    listingId: string,
    renterId: string,
    hostId: string,
  ): Promise<Conversation> {
    const existing = await run(
      sb()
        .from('conversations')
        .select('*')
        .eq('listing_id', listingId)
        .eq('renter_id', renterId)
        .eq('host_id', hostId)
        .maybeSingle(),
    );
    if (existing) return mapRow<Conversation>(existing) as Conversation;

    const now = new Date().toISOString();
    const row = await run(
      sb()
        .from('conversations')
        .insert({
          id: `conv-${Date.now()}`,
          listing_id: listingId,
          renter_id: renterId,
          host_id: hostId,
          last_message_preview: '',
          last_message_at: now,
          unread: 0,
        })
        .select('*')
        .single(),
    );
    return mapRow<Conversation>(row) as Conversation;
  },
  /** Delete a conversation (its messages cascade). Removes it for both parties. */
  async deleteConversation(id: string): Promise<void> {
    await run(sb().from('conversations').delete().eq('id', id).select('id'));
  },
  /** Delete every conversation I'm part of. */
  async deleteAllConversations(): Promise<void> {
    const uid = me();
    await run(
      sb().from('conversations').delete().or(`renter_id.eq.${uid},host_id.eq.${uid}`).select('id'),
    );
  },
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
  /** Total messages addressed to me that I haven't read — drives the header badge. */
  async getUnreadMessageCount(): Promise<number> {
    const { count } = await sb()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .neq('sender_id', me());
    return count ?? 0;
  },
  /** Unread count per conversation (messages from the other party, unread). */
  async getUnreadByConversation(): Promise<Record<string, number>> {
    const rows = await run(
      sb().from('messages').select('conversation_id').is('read_at', null).neq('sender_id', me()),
    );
    const map: Record<string, number> = {};
    for (const r of (rows as { conversation_id: string }[]) ?? []) {
      map[r.conversation_id] = (map[r.conversation_id] ?? 0) + 1;
    }
    return map;
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
  async sendMessage(
    conversationId: string,
    body: string,
    opts?: {
      attachmentUrl?: string;
      attachmentType?: string;
      attachmentName?: string;
      replyTo?: string;
    },
  ): Promise<Message> {
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
          attachment_url: opts?.attachmentUrl ?? null,
          attachment_type: opts?.attachmentType ?? null,
          attachment_name: opts?.attachmentName ?? null,
          reply_to: opts?.replyTo ?? null,
        })
        .select('*')
        .single(),
    );
    const preview = body.trim() || (opts?.attachmentType === 'image' ? '📷 Photo' : '📎 Attachment');
    await run(
      sb()
        .from('conversations')
        .update({ last_message_preview: preview, last_message_at: sentAt, unread: 0 })
        .eq('id', conversationId)
        .select('id'),
    );
    return mapRow<Message>(row) as Message;
  },
  /** Delete one of my own messages. */
  async deleteMessage(id: string): Promise<void> {
    await run(sb().from('messages').delete().eq('id', id).eq('sender_id', me()).select('id'));
  },
  /** Toggle my emoji reaction on a message. */
  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    const uid = me();
    const current = await run(sb().from('messages').select('reactions').eq('id', messageId).single());
    const reactions: Record<string, string[]> = { ...((current?.reactions as Record<string, string[]>) ?? {}) };
    const users = new Set(reactions[emoji] ?? []);
    if (users.has(uid)) users.delete(uid);
    else users.add(uid);
    if (users.size === 0) delete reactions[emoji];
    else reactions[emoji] = [...users];
    await run(sb().from('messages').update({ reactions }).eq('id', messageId).select('id'));
  },
  /** Upload a chat attachment; returns the public URL + a coarse type. */
  async uploadChatFile(file: File): Promise<{ url: string; type: 'image' | 'file'; name: string }> {
    const userId = me();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb()
      .storage.from('chat-files')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    const url = sb().storage.from('chat-files').getPublicUrl(path).data.publicUrl;
    return { url, type: file.type.startsWith('image/') ? 'image' : 'file', name: file.name };
  },
  /** Profiles by id (any role) — used to label chat threads by the other party. */
  async getProfilesByIds(ids: string[]): Promise<Record<string, UserProfile & Partial<Host>>> {
    if (ids.length === 0) return {};
    const rows = await run(sb().from('profiles').select('*').in('id', [...new Set(ids)]));
    const map: Record<string, UserProfile & Partial<Host>> = {};
    for (const r of mapRows<UserProfile & Partial<Host>>(rows as Record<string, unknown>[])) {
      map[r.id] = r;
    }
    return map;
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
          // Messages live in the chat with their own unread badge — keep them out.
          .neq('kind', 'message')
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
  /** Update the signed-in user's own profile (RLS allows id = auth.uid()). */
  async updateProfile(patch: {
    fullName?: string;
    businessName?: string;
    avatarUrl?: string;
    role?: UserProfile['role'];
    ownerType?: 'individual' | 'business';
  }): Promise<UserProfile> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.fullName !== undefined) dbPatch.full_name = patch.fullName;
    if (patch.businessName !== undefined) dbPatch.business_name = patch.businessName;
    if (patch.avatarUrl !== undefined) dbPatch.avatar_url = patch.avatarUrl;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    if (patch.ownerType !== undefined) dbPatch.owner_type = patch.ownerType;
    const row = await run(
      sb().from('profiles').update(dbPatch).eq('id', me()).select('*').single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /** Upload a profile picture to the public `avatars` bucket; returns its URL. */
  async uploadAvatar(file: File): Promise<string> {
    const userId = me();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error } = await sb()
      .storage.from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message);
    return sb().storage.from('avatars').getPublicUrl(path).data.publicUrl;
  },
};
