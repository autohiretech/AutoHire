import type {
  AdminStats,
  AppNotification,
  Booking,
  Conversation,
  Dispute,
  DisputeStatus,
  Flag,
  Host,
  CarCategory,
  HostEarnings,
  Listing,
  Message,
  ModerationStatus,
  PaymentMethodType,
  PayholdDispute,
  PayholdRefund,
  PayholdSeller,
  PayholdWallet,
  Payout,
  PayoutDestination,
  PayoutMethodType,
  PayoutProvider,
  Review,
  UserProfile,
  VerificationDocType,
  VerificationDocument,
  VerificationReviewItem,
  VerificationEvent,
  VerificationStatus,
  KycMetrics,
  KycOwner,
  KycProfile,
  Page,
  ElectricQuota,
  AdminUser,
  AdminAction,
  PublicProfile,
  SocialProof,
  Circle,
  CircleKind,
  CircleMember,
  CircleInvite,
  Board,
  BoardItem,
  ListingDemand,
  TripPost,
  PostVisibility,
  HostBroadcast,
  FeedItem,
} from '@autohire/shared';
import {
  type CreateListingInput,
  type CreateReviewInput,
  type ListingFilters,
} from '@/lib/types';
import { getSupabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/identity';
import { PAYMENTS_PAYHOLD } from '@/lib/payments';
import type { PayoutCountry, PayoutCountryRoute } from '@/lib/payments';

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

/**
 * Split a search string into individual keywords. Listing search then ANDs
 * one `.or()` filter per keyword (chained PostgREST filters combine with AND),
 * so "toyota kigali" needs each word to hit *some* field rather than needing
 * the whole phrase to appear verbatim in one column — the caller isn't
 * required to type an exact title/make/model to get a match.
 */
function keywordsOf(query: string | undefined): string[] {
  return (query ?? '').trim().split(/\s+/).filter(Boolean);
}

/** One keyword, matched case-insensitively across every field worth searching. */
function keywordConditions(word: string): string {
  // Commas and parens are PostgREST's own filter-syntax delimiters, and `%`/`*`
  // are ilike/PostgREST wildcards — strip them so a stray character in the
  // search box can't break the query or widen the match unexpectedly.
  const safe = word.replace(/[%*,()]/g, '');
  if (!safe) return 'id.eq.__no_match__';
  const t = `%${safe}%`;
  return `title.ilike.${t},make.ilike.${t},model.ilike.${t},city.ilike.${t},location.ilike.${t}`;
}

/**
 * The message behind "Edge Function returned a non-2xx status code".
 *
 * supabase-js turns every non-2xx into that one sentence and hands the
 * untouched `Response` over on `error.context`. Our Edge Functions answer with
 * `{ error, code }` — "Set your country before adding a payout method", "Only
 * host accounts receive payouts" — so the sentence the user actually needs is
 * sitting in a body nothing reads, and a 400 they could fix in five seconds
 * arrives looking identical to the function being on fire. This reads it back.
 *
 * `notDeployed` is the other half: a `FunctionsFetchError` never reached a
 * function at all, which is ours to fix and not something to show a user as a
 * failure of what they were doing.
 */
async function fnError(
  error: { name?: string; message: string },
  notDeployed?: string,
): Promise<Error> {
  if (notDeployed && error.name === 'FunctionsFetchError') return new Error(notDeployed);

  const res = (error as { context?: Response }).context;
  if (res && typeof res.clone === 'function') {
    try {
      // Cloned, because the caller may still want to read it and a body can be
      // consumed once. Any failure here falls through to the generic message —
      // an unreadable body must not replace an error with a parse error.
      const body = await res.clone().text();
      const parsed = body ? (JSON.parse(body) as { error?: unknown; message?: unknown }) : null;
      const detail = typeof parsed?.error === 'string'
        ? parsed.error
        : typeof (parsed?.error as { message?: unknown })?.message === 'string'
          ? (parsed!.error as { message: string }).message
          : typeof parsed?.message === 'string'
            ? parsed.message
            : null;
      if (detail) return new Error(detail);
    } catch {
      // Not JSON, or already consumed. The generic message stands.
    }
  }
  return new Error(error.message);
}

/** Await a PostgREST builder, throwing on error and returning data. */
async function run<D>(builder: PromiseLike<{ data: D; error: { message: string } | null }>): Promise<D> {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * chat-files is a private bucket: messages store the storage path (or, for
 * rows from before the bucket went private, its old public URL), and rendering
 * goes through short-lived signed URLs minted here in one batch.
 */
async function signChatAttachments(msgs: Message[]): Promise<Message[]> {
  const toPath = (v: string): string | null => {
    if (!v.startsWith('http')) return v;
    const i = v.indexOf('/chat-files/');
    return i === -1 ? null : decodeURIComponent(v.slice(i + '/chat-files/'.length));
  };
  const pathByMessage = new Map<string, string>();
  for (const m of msgs) {
    const p = m.attachmentUrl ? toPath(m.attachmentUrl) : null;
    if (p) pathByMessage.set(m.id, p);
  }
  if (pathByMessage.size === 0) return msgs;
  const { data } = await sb()
    .storage.from('chat-files')
    .createSignedUrls([...new Set(pathByMessage.values())], 3600);
  const urlByPath = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
  }
  return msgs.map((m) => {
    const p = pathByMessage.get(m.id);
    const url = p ? urlByPath.get(p) : undefined;
    return url ? { ...m, attachmentUrl: url } : m;
  });
}

/**
 * `trip_posts.photos` stores raw `trip-photos` storage paths, never public
 * URLs — the bucket is private (migration 066) so a post's photos are exactly
 * as visible as the post itself. This resolves every path across a batch of
 * posts to a short-lived signed URL in one round trip, same shape as
 * signChatAttachments above.
 */
async function signTripPostPhotos(posts: TripPost[]): Promise<TripPost[]> {
  const allPaths = new Set<string>();
  for (const p of posts) for (const path of p.photos) allPaths.add(path);
  if (allPaths.size === 0) return posts;
  const { data } = await sb().storage.from('trip-photos').createSignedUrls([...allPaths], 3600);
  const urlByPath = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
  }
  return posts.map((p) => ({ ...p, photos: p.photos.map((path) => urlByPath.get(path) ?? path) }));
}

/**
 * Batch-joins `trip_posts` rows against `public_profiles` (author) and
 * `listings` (the denormalized preview) in two round trips regardless of row
 * count. A row whose author isn't resolvable is dropped rather than shown
 * with a blank name — that shouldn't happen (authors are never deleted out
 * from under their own posts, `profiles` cascades), but a feed row silently
 * missing its person is worse than a feed row silently missing.
 */
async function hydratePosts(rows: Record<string, unknown>[] | null): Promise<TripPost[]> {
  const authorIds = [...new Set((rows ?? []).map((r) => r.author_id as string))];
  const listingIds = [...new Set((rows ?? []).map((r) => r.listing_id as string).filter(Boolean))];
  const [profiles, listings] = await Promise.all([
    authorIds.length
      ? mapRows<PublicProfile>(await run(sb().from('public_profiles').select('*').in('id', authorIds)))
      : Promise.resolve([] as PublicProfile[]),
    listingIds.length
      ? mapRows<Listing>(
          await run(sb().from('listings').select('id, title, photos, city, country').in('id', listingIds)),
        )
      : Promise.resolve([] as Listing[]),
  ]);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const listingById = new Map(listings.map((l) => [l.id, l]));

  // "Usually books: SUV" — computed, batched across every author on screen.
  // Empty for every seeded demo post by construction: a demo account has no
  // real bookings behind it, so there's nothing for the function to find.
  const prefRows = authorIds.length
    ? ((await run(sb().rpc('renter_preferred_categories', { p_renter_ids: authorIds }))) ?? [])
    : [];
  const prefsByAuthor = new Map<string, CarCategory[]>();
  for (const r of prefRows as { renter_id: string; category: CarCategory }[]) {
    const list = prefsByAuthor.get(r.renter_id) ?? [];
    list.push(r.category);
    prefsByAuthor.set(r.renter_id, list);
  }

  const hydrated = (rows ?? [])
    .map((row): TripPost | null => {
      const author = profileById.get(row.author_id as string);
      if (!author) return null;
      const listingId = row.listing_id as string | null;
      return {
        id: row.id as string,
        author,
        bookingId: (row.booking_id as string | null) ?? null,
        listing: listingId ? listingById.get(listingId) ?? null : null,
        body: row.body as string,
        photos: (row.photos as string[] | null) ?? [],
        visibility: row.visibility as PostVisibility,
        city: (row.city as string | null) ?? undefined,
        country: (row.country as string | null) ?? undefined,
        createdAt: row.created_at as string,
        isDemo: (row.id as string).startsWith('demo-post-'),
        authorPreferredCategories: prefsByAuthor.get(row.author_id as string),
      };
    })
    .filter((p): p is TripPost => !!p);

  // Seeded demo posts store public loremflickr URLs directly (they were never
  // uploaded to trip-photos), so only sign paths that actually look like
  // storage paths — a demo URL starting with "http" passes through untouched.
  const [toSign, passThrough] = [
    hydrated.filter((p) => p.photos.some((ph) => !ph.startsWith('http'))),
    hydrated.filter((p) => p.photos.every((ph) => ph.startsWith('http'))),
  ];
  const signed = await signTripPostPhotos(toSign);
  const byId = new Map([...signed, ...passThrough].map((p) => [p.id, p]));
  return hydrated.map((p) => byId.get(p.id) ?? p);
}

/** Same batch-join shape as hydratePosts, for the un-anchored broadcast table. */
async function hydrateBroadcasts(rows: Record<string, unknown>[] | null): Promise<HostBroadcast[]> {
  const hostIds = [...new Set((rows ?? []).map((r) => r.host_id as string))];
  const listingIds = [...new Set((rows ?? []).map((r) => r.listing_id as string).filter(Boolean))];
  const [hosts, listings] = await Promise.all([
    hostIds.length
      ? mapRows<PublicProfile>(await run(sb().from('public_profiles').select('*').in('id', hostIds)))
      : Promise.resolve([] as PublicProfile[]),
    listingIds.length
      ? mapRows<Listing>(await run(sb().from('listings').select('id, title, photos').in('id', listingIds)))
      : Promise.resolve([] as Listing[]),
  ]);
  const hostById = new Map(hosts.map((h) => [h.id, h]));
  const listingById = new Map(listings.map((l) => [l.id, l]));

  return (rows ?? [])
    .map((row): HostBroadcast | null => {
      const host = hostById.get(row.host_id as string);
      if (!host) return null;
      const listingId = row.listing_id as string | null;
      return {
        id: row.id as string,
        host,
        body: row.body as string,
        listing: listingId ? listingById.get(listingId) ?? null : null,
        createdAt: row.created_at as string,
      };
    })
    .filter((b): b is HostBroadcast => !!b);
}

export const supabaseClient = {
  // --- Listings ----------------------------------------------------------
  /**
   * Every matching listing, best-rated first. The order matters: the home page's
   * "Featured" slideshow takes the first five of these, and without an ORDER BY
   * PostgREST returns rows in whatever order Postgres pleases (in practice, insertion
   * order) — so the six oldest fixture rows permanently occupied the hero.
   */
  async listListings(filters: ListingFilters = {}): Promise<Listing[]> {
    let q = sb().from('listings').select('*');
    if (filters.country) q = q.eq('country', filters.country);
    if (filters.city) q = q.eq('city', filters.city);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.ownerType) q = q.eq('owner_type', filters.ownerType);
    if (filters.transmission) q = q.eq('transmission', filters.transmission);
    if (filters.fuel) q = q.eq('fuel', filters.fuel);
    if (filters.minSeats) q = q.gte('seats', filters.minSeats);
    if (filters.maxPriceRwf) q = q.lte('price_per_day_rwf', filters.maxPriceRwf);
    for (const word of keywordsOf(filters.query)) q = q.or(keywordConditions(word));
    // Ordering goes last: `.order()` returns a transform builder with no `.eq()`.
    const ordered = q.order('rating_avg', { ascending: false }).order('id', { ascending: true });
    return mapRows<Listing>(await run(ordered));
  },
  /**
   * Paginated listings — same filters as `listListings`, but returns one page
   * plus the total match count so the browse grid can show page controls instead
   * of every car at once. Always ranked best-rated first (then by id for stable
   * paging), so "Recommended for you" leads with the highest-rated cars and the
   * rest follow in the same order.
   */
  async listListingsPage(
    filters: ListingFilters = {},
    page = 0,
    pageSize = 24,
  ): Promise<{ items: Listing[]; total: number }> {
    let base = sb().from('listings').select('*', { count: 'exact' });
    if (filters.country) base = base.eq('country', filters.country);
    if (filters.city) base = base.eq('city', filters.city);
    if (filters.category) base = base.eq('category', filters.category);
    if (filters.ownerType) base = base.eq('owner_type', filters.ownerType);
    if (filters.transmission) base = base.eq('transmission', filters.transmission);
    if (filters.fuel) base = base.eq('fuel', filters.fuel);
    if (filters.minSeats) base = base.gte('seats', filters.minSeats);
    if (filters.maxPriceRwf) base = base.lte('price_per_day_rwf', filters.maxPriceRwf);
    for (const word of keywordsOf(filters.query)) base = base.or(keywordConditions(word));
    const ordered = base.order('rating_avg', { ascending: false }).order('id', { ascending: true });
    const from = page * pageSize;
    const { data, error, count } = await ordered.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { items: mapRows<Listing>(data as Record<string, unknown>[]), total: count ?? 0 };
  },
  /**
   * How many listings exist per country, e.g. `{ RW: 812, US: 3 }`. Powers the
   * country selector: it lets the selector show which of PayHold's many markets
   * actually have cars in AutoHire, without fetching every listing's full row.
   */
  async listingCountsByCountry(): Promise<Record<string, number>> {
    const rows = await run(sb().from('listings').select('country'));
    const counts: Record<string, number> = {};
    for (const row of rows as { country: string }[]) {
      counts[row.country] = (counts[row.country] ?? 0) + 1;
    }
    return counts;
  },
  /**
   * Live foreign-exchange rates (quoted against USD) from the `fx_rates` table,
   * refreshed daily by the `refresh-fx-rates` Edge Function. Returns the newest
   * snapshot so the app can convert prices into the shopper's currency. Rows are
   * one per currency: { code, rate } where rate = units per 1 USD.
   */
  async getFxRates(): Promise<{ base: string; asOf: string; rates: Record<string, number> }> {
    const rows = (await run(
      sb()
        .from('fx_rates')
        .select('quote, rate, as_of')
        .eq('base', 'USD')
        .order('as_of', { ascending: false }),
    )) as { quote: string; rate: number; as_of: string }[] | null;
    const list = rows ?? [];
    const asOf = list[0]?.as_of ?? new Date().toISOString().slice(0, 10);
    // Keep only the newest as_of per currency (the query is date-desc ordered).
    const rates: Record<string, number> = {};
    for (const r of list) if (!(r.quote in rates)) rates[r.quote] = Number(r.rate);
    rates.USD = 1;
    return { base: 'USD', asOf, rates };
  },
  /**
   * AI Mode search: send a natural-language query to the `ai-search` Edge
   * Function, which uses Gemini (server-side) to do anything the renter
   * could do by hand — search filters, a booking request, a message to a
   * host, a watchlist toggle, a trip cancellation, or a plain reply
   * (typically a clarifying question) — any of which may accompany the
   * others. `history` is the prior turns so follow-ups stay contextual;
   * `recentListings`/`recentTrips` are what the model actually has to work
   * with, so it can resolve "book the second one" or "cancel my Friday one".
   * `location` is the renter's browser geolocation, if they granted it, for
   * "near me" requests. Throws a friendly message when the function isn't
   * deployed or AI isn't configured, so the UI can fall back to plain
   * keyword search.
   */
  async aiSearch(input: {
    query: string;
    history?: { role: 'user' | 'assistant'; text: string }[];
    recentListings?: { id: string; title: string; rentalType?: string }[];
    recentTrips?: { id: string; listingId: string; startDate: string; endDate: string; state: string }[];
    location?: { lat: number; lng: number } | null;
    /** ISO 3166-1 alpha-2 — the market the header is currently searching, so
     * the assistant knows what "here" means and only switches it on request. */
    country?: string;
    /** The renter's own account, so the assistant can answer questions about
     * it directly and knows what update_profile is actually changing. */
    profile?: { name: string | null; verification: string | null; accountCountry: string | null } | null;
    /** ISO 4217 codes the renter can display prices in, for set_currency. */
    availableCurrencies?: string[];
    /** The exact listing a renter just clicked (a map marker, a "book this
     * one" affordance) — when set, this is the car, full stop. Several
     * listings can share an identical title, so resolving purely from the
     * query text can't always tell them apart the way this can. */
    selectedListingId?: string;
    /** Filters already active on the results right now — from the
     * assistant's own earlier turns, or the renter clicking a filter chip
     * directly. The model has no other way to see chip-set filters, so
     * without this it can't know to `clear` one that now conflicts with a
     * genuinely new request — it just silently keeps narrowing results
     * toward zero while the reply still sounds confident. */
    currentFilters?: ListingFilters;
  }): Promise<{
    reply: string | null;
    filters: ListingFilters | null;
    /** Filter keys the assistant wants actively unset (e.g. the renter
     * dropped a constraint) — distinct from a key just being absent from
     * `filters`, which means "unchanged," not "cleared." */
    clearFilters: (keyof ListingFilters)[];
    // Only listingId is guaranteed — the model calls this as soon as it
    // knows which car, before dates/time/hours are necessarily known, so the
    // client can prompt for whatever's still missing instead of the model
    // stalling on a text question.
    booking: {
      listingId: string;
      startDate?: string;
      endDate?: string;
      pickupTime?: string;
      rentalType?: 'daily' | 'hourly';
      estimatedHours?: number;
    } | null;
    messageHost: { listingId: string; message: string } | null;
    watchlist: { listingId: string; action: 'add' | 'remove' } | null;
    cancelTrip: { bookingId: string } | null;
    updateProfile: { fullName?: string; country?: string } | null;
    setCurrency: { currencyCode: string } | null;
  }> {
    const { data, error } = await getSupabase().functions.invoke('ai-search', {
      body: input,
    });
    if (error) {
      throw await fnError(
        error,
        "AI search isn't deployed yet — deploy the ai-search Edge Function.",
      );
    }
    const payload = data as {
      reply?: string | null;
      filters?: ListingFilters | null;
      clearFilters?: (keyof ListingFilters)[];
      booking?: {
        listingId: string;
        startDate?: string;
        endDate?: string;
        pickupTime?: string;
        rentalType?: 'daily' | 'hourly';
        estimatedHours?: number;
      } | null;
      messageHost?: { listingId: string; message: string } | null;
      watchlist?: { listingId: string; action: 'add' | 'remove' } | null;
      cancelTrip?: { bookingId: string } | null;
      updateProfile?: { fullName?: string; country?: string } | null;
      setCurrency?: { currencyCode: string } | null;
      error?: string;
    };
    if (payload?.error) throw new Error(payload.error);
    return {
      reply: payload?.reply ?? null,
      filters: payload?.filters ?? null,
      clearFilters: payload?.clearFilters ?? [],
      booking: payload?.booking ?? null,
      messageHost: payload?.messageHost ?? null,
      watchlist: payload?.watchlist ?? null,
      cancelTrip: payload?.cancelTrip ?? null,
      updateProfile: payload?.updateProfile ?? null,
      setCurrency: payload?.setCurrency ?? null,
    };
  },
  /** Follows a shortened Google Maps link (goo.gl/maps/…, maps.app.goo.gl/…)
   * server-side and hands back wherever it actually landed — a browser's own
   * fetch can't read a cross-origin redirect's final URL, only a server can.
   * web/src/lib/location.ts then pulls the coordinate out of that resolved
   * URL the same way as any long-form Maps link. */
  async resolveMapsLink(url: string): Promise<string> {
    const { data, error } = await getSupabase().functions.invoke('resolve-maps-link', {
      body: { url },
    });
    if (error) throw await fnError(error, "Couldn't resolve that link.");
    const payload = data as { resolvedUrl?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    if (!payload?.resolvedUrl) throw new Error("Couldn't resolve that link.");
    return payload.resolvedUrl;
  },
  // --- AI chat history (migration 073) ------------------------------------
  /** The renter's own past conversations, newest first — a preview (its
   * first turn's query) and when it last changed, not the full turns. What
   * the assistant's "choose an old chat" list actually needs. */
  async listChatSessions(limit = 20): Promise<{ id: string; updatedAt: string; preview: string | null }[]> {
    const rows = await run(
      sb()
        .from('ai_chat_sessions')
        .select('id, turns, updated_at')
        .eq('profile_id', me())
        .order('updated_at', { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map((r) => {
      const turns = (r.turns as { query?: string }[] | null) ?? [];
      return {
        id: r.id as string,
        updatedAt: r.updated_at as string,
        preview: turns[0]?.query ?? null,
      };
    });
  },
  /** The single most recent conversation, if any — what a fresh mount of the
   * assistant resumes into. */
  async getLatestChatSession(): Promise<{ id: string; turns: unknown[] } | null> {
    const row = await run(
      sb()
        .from('ai_chat_sessions')
        .select('id, turns')
        .eq('profile_id', me())
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return row ? { id: row.id as string, turns: (row.turns as unknown[] | null) ?? [] } : null;
  },
  async getChatSession(id: string): Promise<{ id: string; turns: unknown[] } | null> {
    const row = await run(
      sb().from('ai_chat_sessions').select('id, turns').eq('id', id).eq('profile_id', me()).maybeSingle(),
    );
    return row ? { id: row.id as string, turns: (row.turns as unknown[] | null) ?? [] } : null;
  },
  /** Starts a new, empty conversation row — "New chat" in the assistant. */
  async createChatSession(): Promise<string> {
    const id = `chat-${Date.now()}`;
    await run(sb().from('ai_chat_sessions').insert({ id, profile_id: me(), turns: [] }).select('id'));
    return id;
  },
  /** Upsert, not update — the assistant may still be lazily creating the
   * session on its first turn when this fires. */
  async saveChatSession(id: string, turns: unknown[]): Promise<void> {
    await run(
      sb()
        .from('ai_chat_sessions')
        .upsert(
          { id, profile_id: me(), turns: turns as never, updated_at: new Date().toISOString() },
          { onConflict: 'id' },
        )
        .select('id'),
    );
  },
  async deleteChatSession(id: string): Promise<void> {
    await run(sb().from('ai_chat_sessions').delete().eq('id', id).eq('profile_id', me()).select('id'));
  },
  async getListing(id: string) {
    return mapRow<Listing>(await run(sb().from('listings').select('*').eq('id', id).maybeSingle()));
  },
  async getHost(id: string) {
    // Full row only for self / admins / booking or conversation counterparties
    // (RLS filters it out otherwise) — everyone else gets the PII-free view.
    const full = await run(sb().from('profiles').select('*').eq('id', id).maybeSingle());
    if (full) return mapRow<Host>(full);
    return mapRow<Host>(await run(sb().from('public_profiles').select('*').eq('id', id).maybeSingle()));
  },
  async listHosts(): Promise<Host[]> {
    return mapRows<Host>(await run(sb().from('public_profiles').select('*').not('owner_type', 'is', null)));
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
   * Find the trip a PayHold deal paid for. The booking itself is written by
   * `payhold-webhook`, not by the browser that just finished checkout, so
   * there is a real gap — sometimes a couple of seconds — between PayHold
   * saying the deal funded and this row existing. Callers should poll rather
   * than treat one `undefined` as "no booking."
   */
  async getBookingByDealId(dealId: string): Promise<Booking | undefined> {
    return mapRow<Booking>(
      await run(sb().from('bookings').select('*').eq('payhold_deal_id', dealId).maybeSingle()),
    );
  },
  /**
   * Finalise a booking. There is no client-side insert: the `confirm-booking`
   * Edge Function recomputes the amounts and writes the row with the service
   * role, so the renter can't set their own price, days or status. RLS blocks
   * direct client inserts (migration-029), so this is the ONLY path in both
   * modes — including demo.
   *
   * In live mode it verifies the Stripe PaymentIntent (pass `paymentIntentId`).
   * In demo mode (no Stripe configured server-side) it confirms instantly from
   * the listing + dates — no real charge. listingId/startDate/endDate are sent
   * for both, and the function also enforces the renter's identity verification.
   */
  async confirmBooking(input: {
    listingId: string;
    startDate: string;
    endDate: string;
    paymentIntentId?: string;
    /** External hold system: the hold's reference (re-read server-side). */
    reference?: string;
  }): Promise<Booking> {
    const { data, error } = await getSupabase().functions.invoke('confirm-booking', {
      body: input,
    });
    if (error) {
      throw await fnError(
        error,
        "Bookings aren't deployed yet — deploy the confirm-booking Edge Function.",
      );
    }
    const payload = data as { booking?: Booking; error?: string };
    if (payload?.error || !payload?.booking) {
      throw new Error(payload?.error ?? 'Could not confirm the booking.');
    }
    return payload.booking;
  },

  /**
   * Open an escrow hold on the external payment system. Returns whatever the
   * browser needs to finish it: a Stripe `clientSecret` (the external system
   * settles through Stripe), a `redirectUrl` to their hosted page, or neither
   * when the hold is already authorised. `reference` then goes to
   * `confirmBooking`, which re-reads the hold server-side before creating a trip.
   */
  async createExternalHold(input: {
    listingId: string;
    startDate: string;
    endDate: string;
    returnUrl?: string;
  }): Promise<{
    reference: string;
    status: string;
    clientSecret?: string;
    redirectUrl?: string;
    totalRwf?: number;
  }> {
    const { data, error } = await getSupabase().functions.invoke('external-create-hold', {
      body: input,
    });
    if (error) {
      throw await fnError(
        error,
        "External payments aren't deployed yet — deploy the external-create-hold Edge Function.",
      );
    }
    const payload = data as {
      reference?: string;
      status?: string;
      clientSecret?: string;
      redirectUrl?: string;
      totalRwf?: number;
      error?: string;
    };
    if (payload?.error || !payload?.reference) {
      throw new Error(payload?.error ?? 'Could not start the payment.');
    }
    return { ...payload, reference: payload.reference, status: payload.status ?? 'pending' };
  },

  /**
   * Open a PayHold deal for a booking and get the hosted checkout link.
   *
   * No booking row exists yet — the renter pays on PayHold's page, and the trip
   * is created by `payhold-webhook` when the money is actually held. The link is
   * a redirect away from AutoHire, so nothing here should be treated as a
   * completed payment.
   */
  async createPayholdDeal(input: {
    listingId: string;
    startDate: string;
    endDate: string;
    /** Agreed pickup time-of-day (HH:mm) — what a late return is measured from. */
    pickupTime: string;
    /** Priced by the calendar day, or by actual hours used (50% deposit now). */
    rentalType: 'daily' | 'hourly';
    /** Required when rentalType is 'hourly' — the duration the deposit is against. */
    estimatedHours?: number;
    /** What the renter chose on `/cars/:id/pay`. A preference, not an instruction. */
    preferredMethod?: PaymentMethodType;
    /**
     * Where they want to be charged — a MoMo number, a PayPal address. Never a
     * card: the server refuses anything that passes a Luhn check, because this
     * rides in the deal's metadata and PayHold stores metadata verbatim.
     */
    payerRef?: string;
    /**
     * Which market to charge the card as, when it isn't the renter's own
     * account country — PayHold prices the deal in whatever currency that
     * market's rails serve, so this is how a renter paying with a foreign card
     * gets charged in a currency it actually accepts.
     */
    buyerCountry?: string;
  }): Promise<{
    dealId: string;
    paymentLink: string;
    status: string;
    total: number;
    /** PayHold's public session URL — null when sessions are unavailable. */
    checkoutBase: string | null;
  }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-create-deal', {
      body: input,
    });
    if (error) {
      throw await fnError(
        error,
        "PayHold isn't deployed yet — deploy the payhold-create-deal Edge Function.",
      );
    }
    const payload = data as {
      dealId?: string;
      paymentLink?: string;
      status?: string;
      total?: number;
      checkoutBase?: string | null;
      error?: string;
    };
    if (payload?.error || !payload?.dealId || !payload?.paymentLink) {
      throw new Error(payload?.error ?? 'Could not start the payment.');
    }
    return {
      dealId: payload.dealId,
      paymentLink: payload.paymentLink,
      status: payload.status ?? 'created',
      total: payload.total ?? 0,
      checkoutBase: payload.checkoutBase ?? null,
    };
  },

  /**
   * Save where this host is paid — their first destination, or a later one.
   *
   * One call for both because it is one thing to a host ("save my payout
   * method") and two things to PayHold: a registration mints a seller, a change
   * adds a destination and puts it under a security hold. The server knows
   * which it is from whether the profile already has a seller id, and says so
   * in `changed`.
   *
   * The raw destination is sent once, to be tokenized, and is never stored on
   * either side — AutoHire keeps the seller id and a mask. This is why payout
   * setup goes through a function rather than a table write.
   */
  async registerPayholdSeller(input: {
    method: PayoutMethodType;
    destination: string;
  }): Promise<{
    sellerId: string;
    maskedDestination: string;
    /**
     * True when PayHold already had a seller for this host and we re-linked it
     * rather than registering a second one. The destination just typed was NOT
     * saved — the profile's link was being repaired, and saving again now goes
     * down the `changed` path below.
     */
    relinked: boolean;
    /**
     * True when this moved an existing host's destination rather than
     * registering a new one. Payouts pause until PayHold verifies the new
     * account and its security hold expires — see `securityHoldUntil`.
     */
    changed: boolean;
    /** When the new destination leaves §5.1's hold. Null on a registration. */
    securityHoldUntil: string | null;
    canReceivePayouts: boolean;
    reasons: string[];
    routeReasons: string[];
  }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-register-seller', {
      body: input,
    });
    if (error) throw await fnError(error);
    const payload = data as {
      sellerId?: string;
      maskedDestination?: string;
      relinked?: boolean;
      changed?: boolean;
      securityHoldUntil?: string | null;
      canReceivePayouts?: boolean;
      reasons?: string[];
      routeReasons?: string[];
      error?: string;
    };
    if (payload?.error || !payload?.sellerId) {
      throw new Error(payload?.error ?? 'Could not save your payout method.');
    }
    return {
      sellerId: payload.sellerId,
      maskedDestination: payload.maskedDestination ?? '',
      relinked: payload.relinked ?? false,
      changed: payload.changed ?? false,
      securityHoldUntil: payload.securityHoldUntil ?? null,
      canReceivePayouts: payload.canReceivePayouts ?? false,
      reasons: payload.reasons ?? [],
      routeReasons: payload.routeReasons ?? [],
    };
  },

  /**
   * Register a host as a PayHold seller with no payout destination — called
   * right after switching to host mode, before they have typed anything.
   *
   * Money can accrue against a seller in this state; only a payout is blocked,
   * on PayHold's own eligibility gate. This is deliberately a *different*
   * operation from `registerPayholdSeller`, which is the only place a raw
   * destination is ever typed and tokenized — that one still runs when the
   * host reaches payout setup, and finds a seller already here to add a
   * destination to rather than creating one from scratch.
   *
   * Idempotent: a host who already has one gets `alreadyLinked: true` back
   * rather than a second attempt at PayHold.
   */
  async ensurePayholdSeller(): Promise<{ sellerId: string; alreadyLinked: boolean }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-ensure-seller', {
      body: {},
    });
    if (error) throw await fnError(error);
    const payload = data as { sellerId?: string; alreadyLinked?: boolean; error?: string };
    if (payload?.error || !payload?.sellerId) {
      throw new Error(payload?.error ?? 'Could not register you as a seller.');
    }
    return { sellerId: payload.sellerId, alreadyLinked: payload.alreadyLinked ?? false };
  },

  /**
   * The other direction: marks the signed-in host's PayHold seller inactive.
   * Status only, and a quiet no-op for a profile with no seller yet — most
   * renters have never hosted, and "nothing to turn off" is the expected
   * answer, not a failure.
   */
  async deactivatePayholdSeller(): Promise<void> {
    const { error } = await getSupabase().functions.invoke('payhold-deactivate-seller', {
      body: {},
    });
    if (error) throw await fnError(error);
  },

  /**
   * Push this host's current name to PayHold, so its Sellers dashboard never
   * shows a name a profile edit already moved past. No-op for a profile with
   * no `payhold_seller_id` yet — reads it fresh from the profile row itself
   * rather than trusting whatever the caller has in memory.
   */
  async syncPayholdSellerName(): Promise<void> {
    const { error } = await getSupabase().functions.invoke('payhold-sync-seller-name', {
      body: {},
    });
    if (error) throw await fnError(error);
  },

  /**
   * This host's wallet, read live from PayHold — never cached in our database,
   * because a stale balance is one a host makes plans against.
   *
   * `balances` is ledger money in the currency the renter was charged;
   * `withdrawable` is what a withdrawal would move, in the host's own payout
   * currency. A cross-border trip makes those different numbers.
   */
  async payholdBalance(): Promise<PayholdWallet> {
    const { data, error } = await getSupabase().functions.invoke('payhold-balance', {
      method: 'GET',
    });
    if (error) throw await fnError(error);
    const payload = data as PayholdWallet & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return {
      sellerId: payload.sellerId ?? null,
      balances: payload.balances ?? [],
      withdrawable: payload.withdrawable ?? [],
      canReceivePayouts: payload.canReceivePayouts ?? false,
      kycStatus: payload.kycStatus ?? 'pending',
      reasons: payload.reasons ?? [],
      routeReasons: payload.routeReasons ?? [],
    };
  },

  /**
   * Every trip's money and the stage it's at, plus where it can be sent.
   *
   * The wallet totals answer "how much"; this answers "which trip, and where is
   * that money" — the question a host asks when a number looks wrong.
   */
  async payholdEarnings(offset = 0): Promise<HostEarnings> {
    const { data, error } = await getSupabase().functions.invoke(
      `payhold-earnings?offset=${offset}`,
      { method: 'GET' },
    );
    if (error) throw await fnError(error);
    const payload = data as HostEarnings & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return {
      sellerId: payload.sellerId ?? null,
      trips: payload.trips ?? [],
      destinations: payload.destinations ?? [],
      hasMore: payload.hasMore ?? false,
    };
  },

  /**
   * Ask PayHold to send the cleared money. `destinationId` picks among the
   * host's own registered destinations — it can never name a new address.
   */
  async payholdWithdraw(destinationId?: string): Promise<{ requested: number; message: string }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-balance', {
      method: 'POST',
      body: destinationId ? { destinationId } : {},
    });
    if (error) throw await fnError(error);
    const payload = data as { requested?: number; message?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return { requested: payload.requested ?? 0, message: payload.message ?? 'Withdrawal requested.' };
  },

  /**
   * Confirm this side of a finished trip. When both sides have, PayHold
   * releases the held money to the host. Which side you are is decided from
   * your session server-side, not passed in.
   */
  async payholdConfirm(bookingId: string): Promise<{ dealStatus: string; side: string }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-confirm', {
      body: { bookingId },
    });
    if (error) throw await fnError(error);
    const payload = data as { dealStatus?: string; side?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return { dealStatus: payload.dealStatus ?? 'unknown', side: payload.side ?? '' };
  },

  /**
   * This host's PayHold seller record — the thing that decides whether they can
   * be paid at all. Separate from `payholdBalance` because "can PayHold reach
   * me" and "how much is in there" change on different clocks, and the first is
   * what a host needs when a payout has not arrived.
   *
   * `hostId` is admin-only and refused for anyone else, so a host can never
   * read where another host gets paid.
   */
  async payholdSeller(hostId?: string): Promise<PayholdSeller> {
    const { data, error } = await getSupabase().functions.invoke(
      hostId ? `payhold-seller?hostId=${encodeURIComponent(hostId)}` : 'payhold-seller',
      { method: 'GET' },
    );
    if (error) throw await fnError(error);
    const payload = data as PayholdSeller & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return {
      sellerId: payload.sellerId ?? null,
      registered: payload.registered ?? false,
      host: payload.host ?? null,
      payout: payload.payout ?? null,
      canReceivePayouts: payload.canReceivePayouts ?? false,
      kycStatus: payload.kycStatus ?? 'unknown',
      reasons: payload.reasons ?? [],
      routeReasons: payload.routeReasons ?? [],
      // Undefined → null, deliberately. See the note on the type: an empty
      // array means "nowhere to be paid" and must not be faked here.
      destinations: payload.destinations ?? null,
    };
  },

  /**
   * Which countries PayHold can collect in and pay out to, and — separately —
   * every currency it can collect tenant-wide (`currencies`). That second list
   * is the authority for "what currencies does PayHold accept": it is not the
   * same set as `countries.map(c => c.currency)`, since a currency a rail can
   * collect need not be any one country's *home* currency (USD collects almost
   * everywhere, for instance), so deriving one from the other under-counts.
   *
   * The payout screen asks this before offering anything, because the answer
   * used to be a hardcoded eight-country list that promised Bank and Card to
   * markets PayHold refuses. Tenant-wide and slow-moving, so it is cached hard
   * on both sides.
   */
  async payholdPayoutCountries(): Promise<{ countries: PayoutCountry[]; currencies: string[] }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-payment-options', {
      method: 'GET',
    });
    if (error) throw await fnError(error);
    const payload = data as { countries?: PayoutCountry[]; currencies?: string[]; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return { countries: payload.countries ?? [], currencies: payload.currencies ?? [] };
  },

  /**
   * What THIS country can actually be paid with — `payoutRoute`'s own
   * decision, the same one `route_payout` would reach. The bulk list above can
   * only say whether a country is payable at all; this is what the payout
   * screen uses to decide which methods to offer inside one that is.
   */
  async payholdPayoutRoute(country: string): Promise<PayoutCountryRoute> {
    const { data, error } = await getSupabase().functions.invoke(
      `payhold-payment-options?country=${encodeURIComponent(country)}`,
      { method: 'GET' },
    );
    if (error) throw await fnError(error);
    const payload = data as PayoutCountryRoute & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload;
  },

  /**
   * Start (or resume) Stripe Connect onboarding — the one payout method that
   * isn't a form field. `payoutProviderFor` routes bank/card outside Africa
   * to `stripe_connect`, whose destination is an account id Stripe mints
   * during its own hosted onboarding, not a number a host can type. Returns
   * a one-time link to redirect the host to.
   */
  async startStripeConnectOnboarding(): Promise<{ url: string }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-stripe-connect', {
      method: 'POST',
    });
    if (error) throw await fnError(error);
    const payload = data as { url?: string; error?: string };
    if (payload?.error || !payload?.url) {
      throw new Error(payload?.error ?? "Couldn't start Stripe onboarding.");
    }
    return { url: payload.url };
  },

  /**
   * Has Stripe finished it? Called from the return page rather than trusted
   * from the redirect itself — a `connected` result means the payout method
   * is already saved server-side, same as any other destination change.
   */
  async stripeConnectStatus(): Promise<
    | { status: 'not_started' }
    | { status: 'pending' }
    | { status: 'connected'; maskedDestination: string }
  > {
    const { data, error } = await getSupabase().functions.invoke('payhold-stripe-connect', {
      method: 'GET',
    });
    if (error) throw await fnError(error);
    const payload = data as {
      status?: 'not_started' | 'pending' | 'connected';
      destination?: { masked_destination?: string };
      error?: string;
    };
    if (payload?.error) throw new Error(payload.error);
    if (payload.status === 'connected') {
      return { status: 'connected', maskedDestination: payload.destination?.masked_destination ?? '' };
    }
    return { status: payload.status === 'pending' ? 'pending' : 'not_started' };
  },

  /** Where this host's money can be sent, on its own — the narrow read. */
  async payholdDestinations(): Promise<PayoutDestination[]> {
    const { data, error } = await getSupabase().functions.invoke('payhold-seller/destinations', {
      method: 'GET',
    });
    if (error) throw await fnError(error);
    const payload = data as { destinations?: PayoutDestination[]; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload.destinations ?? [];
  },

  /** Every dispute this person is party to, both raised and received. */
  async payholdDisputes(): Promise<PayholdDispute[]> {
    const { data, error } = await getSupabase().functions.invoke('payhold-dispute', {
      method: 'GET',
    });
    if (error) throw await fnError(error);
    const payload = data as { disputes?: PayholdDispute[]; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload.disputes ?? [];
  },

  /**
   * Raise a dispute — in PayHold first, then here.
   *
   * This is the call that FREEZES the payout on the booking's deal. A dispute
   * that only lived in AutoHire watched the host's money clear and go out.
   *
   * Which side you are is decided from your session server-side. `amount` is in
   * whole units of the booking's charge currency; omit it to dispute the trip
   * in full.
   */
  async openPayholdDispute(input: {
    bookingId: string;
    reason: string;
    reasonCode?: string;
    amount?: number;
  }): Promise<{
    disputeId: string;
    payholdDisputeId: string | null;
    /** Whether a payout is actually being held. False = a complaint, not a hold. */
    frozen: boolean;
    side: string;
  }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-dispute', {
      body: input,
    });
    if (error) throw await fnError(error);
    const payload = data as {
      disputeId?: string;
      payholdDisputeId?: string | null;
      frozen?: boolean;
      side?: string;
      error?: string;
    };
    if (payload?.error || !payload?.disputeId) {
      throw new Error(payload?.error ?? 'Could not open the dispute.');
    }
    return {
      disputeId: payload.disputeId,
      payholdDisputeId: payload.payholdDisputeId ?? null,
      frozen: payload.frozen ?? false,
      side: payload.side ?? '',
    };
  },

  /**
   * Send a renter's money back, in full or in part. Hosts may refund their own
   * bookings; admins may refund any. A renter cannot refund themselves — they
   * open a dispute, which freezes the money for a person to decide.
   *
   * The booking is NOT marked refunded by this call. PayHold answers when it
   * accepts the refund; `refund.succeeded` is what says the money landed.
   */
  async payholdRefund(input: {
    bookingId: string;
    reason: string;
    amount?: number;
  }): Promise<PayholdRefund> {
    const { data, error } = await getSupabase().functions.invoke('payhold-refund', {
      body: input,
    });
    if (error) throw await fnError(error);
    const payload = data as PayholdRefund & { error?: string };
    if (payload?.error || !payload?.dealId) {
      throw new Error(payload?.error ?? 'Could not send the refund.');
    }
    return {
      dealId: payload.dealId,
      dealStatus: payload.dealStatus ?? 'unknown',
      partial: payload.partial ?? false,
      amount: payload.amount ?? null,
      currency: payload.currency ?? 'RWF',
      message: payload.message ?? 'Refund sent.',
    };
  },

  /**
   * Start a Flutterwave collection for an African-market car (card or mobile
   * money). Returns a hosted-payment `link` to redirect to in live mode, or
   * `{ demo: true }` when no provider is configured (the caller then falls back
   * to the demo confirm-booking path).
   */
  async startFlutterwaveCollection(input: {
    listingId: string;
    startDate: string;
    endDate: string;
  }): Promise<{ link?: string; demo?: boolean; txRef?: string }> {
    const { data, error } = await getSupabase().functions.invoke('flutterwave-collect', { body: input });
    if (error) throw await fnError(error);
    const payload = data as { link?: string; demo?: boolean; txRef?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload;
  },

  /**
   * Register a host's raw payout destination with Flutterwave (live) and store
   * only the returned beneficiary token + masked label. Used by payout setup in
   * live mode; the demo path uses `setPayoutMethod` instead.
   */
  async connectPayoutBeneficiary(input: {
    method: 'momo' | 'bank';
    destination: string;
    accountBank?: string;
  }): Promise<UserProfile> {
    const { data, error } = await getSupabase().functions.invoke('flutterwave-beneficiary', { body: input });
    if (error) throw await fnError(error);
    const payload = data as { profile?: Record<string, unknown>; error?: string };
    if (payload?.error || !payload?.profile) throw new Error(payload?.error ?? 'Could not save destination.');
    return mapRow<UserProfile>(payload.profile) as UserProfile;
  },

  /** Capture the held Stripe authorisation when a trip starts (no-op for Flutterwave). */
  async capturePayment(bookingId: string): Promise<void> {
    await getSupabase().functions.invoke('capture-payment', { body: { bookingId } });
  },

  /**
   * Tell PayHold this side is satisfied with the return handoff. Which side
   * (buyer/seller) comes from the caller's own session on the server, never
   * from here — see `payhold-confirm`. PayHold releases the hold once BOTH
   * sides have confirmed, atomically on its side; this is one of the two
   * confirmations, not the release itself.
   */
  async confirmPayholdDeal(
    bookingId: string,
    overageOverrideMinor?: number,
  ): Promise<{ dealStatus: string }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-confirm', {
      body: {
        bookingId,
        ...(overageOverrideMinor === undefined ? {} : { overageOverrideMinor }),
      },
    });
    if (error) throw await fnError(error);
    return data as { dealStatus: string };
  },

  /**
   * Turn the now-complete pickup/return handoff timestamps into what an hourly
   * rental actually cost, or what a late daily return owes. Only meaningful
   * once both sides have signed the return — see `payhold-settle-usage`.
   */
  async settleBookingUsage(bookingId: string): Promise<{
    actualHours: number;
    finalAmountRwf: number | null;
    amountOwedRwf: number;
  }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-settle-usage', {
      body: { bookingId },
    });
    if (error) throw await fnError(error);
    return data as { actualHours: number; finalAmountRwf: number | null; amountOwedRwf: number };
  },

  /**
   * The host records what actually happened with an outstanding amount —
   * they collected it themselves outside PayHold (pass 0), or they're
   * waiving some or all of it. This never charges anyone: PayHold has no way
   * to add money to a deal it has already funded, and this doesn't try to
   * build one. `booking_enforce_update` (migration 055) is what actually
   * enforces the host-only, never-increase rule — this is a plain update.
   */
  async adjustAmountOwed(bookingId: string, newAmountOwedRwf: number): Promise<Booking> {
    const row = await run(
      sb()
        .from('bookings')
        .update({ amount_owed_rwf: newAmountOwedRwf })
        .eq('id', bookingId)
        .select('*')
        .maybeSingle(),
    );
    return mapRow<Booking>(row) as Booking;
  },

  /**
   * The host confirms they collected an overage charge in person — PayHold
   * couldn't auto-charge it (the renter paid by a method with no saved
   * credential), so `payhold-webhook` flagged the booking on
   * `order.balance_charge_failed`. This clears the flag; it never charges
   * anyone, the same reasoning `adjustAmountOwed` carries. Migration 057's
   * `booking_enforce_update` is what actually enforces host-only and
   * clear-only — this is a plain update.
   */
  async acknowledgeOverageCollected(bookingId: string): Promise<Booking> {
    const row = await run(
      sb()
        .from('bookings')
        .update({ overage_collection_failed: false, overage_collection_failed_reason: null })
        .eq('id', bookingId)
        .select('*')
        .maybeSingle(),
    );
    return mapRow<Booking>(row) as Booking;
  },

  /** Admin: disburse a scheduled host payout via its provider. */
  async disbursePayout(payoutId: string): Promise<unknown> {
    const { data, error } = await getSupabase().functions.invoke('flutterwave-transfer', {
      body: { payoutId },
    });
    if (error) throw await fnError(error);
    return data;
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
    /** The host's own reduce-or-waive lever on a late charge. Ignored for the renter's own confirmation — see `confirmPayholdDeal`. */
    overageOverrideMinor?: number,
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
    const booking = mapRow<Booking>(row as Record<string, unknown>) as Booking;
    if (PAYMENTS_PAYHOLD) {
      // Confirming the RETURN is what `payhold-confirm` is for — it is this
      // caller's own side of "I'm satisfied with how this trip ended", and
      // PayHold releases the hold once both the renter's and the host's
      // confirmation have landed. Fired every time either side confirms a
      // return, not just once both have — each call is only ever this
      // caller's own side. Best-effort: a booking not paid through PayHold
      // (`too_early`/409 before the trip is even active is the other case
      // this can hit) must never block the handoff itself.
      if (phase === 'return') {
        supabaseClient.confirmPayholdDeal(booking.id, overageOverrideMinor).catch((e) => {
          console.error('confirmPayholdDeal failed', e);
        });
        // Only meaningful once BOTH sides have signed the return — this is
        // the one confirmHandoff() call (whichever side happens to be second)
        // that sees the booking actually reach 'completed'. Best-effort, same
        // reasoning as confirmPayholdDeal above: it must never block the
        // handoff itself.
        if (booking.state === 'completed') {
          supabaseClient.settleBookingUsage(booking.id).catch((e) => {
            console.error('settleBookingUsage failed', e);
          });
        }
      }
    } else if (booking.state === 'active') {
      // Pre-PayHold rail: trip just started (both sides signed pickup) →
      // capture the escrow hold directly. Best-effort: a failed/undeployed
      // capture must never block the handoff.
      supabaseClient.capturePayment(booking.id).catch(() => {});
    }
    return booking;
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
  /**
   * Cancel a booking and refund it (host: confirmed/pickup; renter:
   * requested/confirmed). Under PayHold, refunding is not instant: this sends
   * the refund to PayHold and the booking's own state moves to `cancelled`
   * once the `refund.succeeded` webhook confirms the money actually landed —
   * `pending: true` means exactly that, not a failure.
   */
  async cancelBooking(id: string): Promise<{ cancelled: boolean; pending: boolean; message?: string }> {
    if (PAYMENTS_PAYHOLD) {
      const { data, error } = await getSupabase().functions.invoke('payhold-cancel-booking', {
        body: { bookingId: id },
      });
      if (error) throw await fnError(error);
      const payload = data as {
        cancelled?: boolean;
        pending?: boolean;
        message?: string;
        error?: string;
      };
      if (payload?.error) throw new Error(payload.error);
      return { cancelled: !!payload.cancelled, pending: !!payload.pending, message: payload.message };
    }
    // Pre-PayHold rail: no unified refund call exists here, so this keeps the
    // direct write it always did.
    await run(
      sb()
        .from('bookings')
        .update({ state: 'cancelled', payment_status: 'refunded' })
        .eq('id', id)
        .select('*')
        .single(),
    );
    return { cancelled: true, pending: false };
  },
  /** A single profile by id (renter or host). */
  async getProfile(id: string): Promise<(UserProfile & Partial<Host>) | undefined> {
    const full = await run(sb().from('profiles').select('*').eq('id', id).maybeSingle());
    if (full) return mapRow<UserProfile & Partial<Host>>(full);
    return mapRow<UserProfile & Partial<Host>>(
      await run(sb().from('public_profiles').select('*').eq('id', id).maybeSingle()),
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
        | 'pricingMode'
        | 'pricePerDayRwf'
        | 'priceCurrency'
        | 'pricePerHourRwf'
        | 'overageMultiplier'
        | 'country'
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
      pricingMode: 'pricing_mode',
      pricePerDayRwf: 'price_per_day_rwf',
      priceCurrency: 'price_currency',
      pricePerHourRwf: 'price_per_hour_rwf',
      overageMultiplier: 'overage_multiplier',
      country: 'country',
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
          pricing_mode: input.pricingMode,
          price_per_day_rwf: input.pricePerDayRwf ?? null,
          price_currency: input.priceCurrency ?? 'RWF',
          price_per_hour_rwf: input.pricePerHourRwf ?? null,
          overage_multiplier: input.overageMultiplier ?? 2,
          country: input.country ?? 'RW',
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
    const msgs = mapRows<Message>(
      await run(
        sb().from('messages').select('*').eq('conversation_id', conversationId).order('sent_at'),
      ),
    );
    return signChatAttachments(msgs);
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
  /**
   * Upload a chat attachment to the private chat-files bucket. Returns the
   * storage path — messages store the path, and `listMessages` swaps it for a
   * signed URL when rendering.
   */
  async uploadChatFile(file: File): Promise<{ url: string; type: 'image' | 'file'; name: string }> {
    const userId = me();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb()
      .storage.from('chat-files')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    return { url: path, type: file.type.startsWith('image/') ? 'image' : 'file', name: file.name };
  },
  /** Profiles by id (any role) — used to label chat threads by the other party. */
  async getProfilesByIds(ids: string[]): Promise<Record<string, UserProfile & Partial<Host>>> {
    if (ids.length === 0) return {};
    const unique = [...new Set(ids)];
    const rows = await run(sb().from('profiles').select('*').in('id', unique));
    const map: Record<string, UserProfile & Partial<Host>> = {};
    for (const r of mapRows<UserProfile & Partial<Host>>(rows as Record<string, unknown>[])) {
      map[r.id] = r;
    }
    // Ids RLS filtered out (not a counterparty) still need a name/avatar label.
    const missing = unique.filter((id) => !map[id]);
    if (missing.length > 0) {
      const pub = await run(sb().from('public_profiles').select('*').in('id', missing));
      for (const r of mapRows<UserProfile & Partial<Host>>(pub as Record<string, unknown>[])) {
        map[r.id] = r;
      }
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

  // --- Watchlist ---------------------------------------------------------
  /**
   * Cars the signed-in account is watching. Watching is not booking — hosts and
   * companies may watch too — it subscribes you to a notification when the car
   * comes back into service or the trip on it ends (see migration 043).
   */
  async listWatchlist(): Promise<string[]> {
    const rows = await run(sb().from('watchlist').select('listing_id').eq('profile_id', me()));
    return (rows ?? []).map((r) => r.listing_id as string);
  },
  /** The watched cars themselves, newest watch first — one round trip. */
  async listWatchedListings(): Promise<Listing[]> {
    const rows = await run(
      sb()
        .from('watchlist')
        .select('created_at, listings(*)')
        .eq('profile_id', me())
        .order('created_at', { ascending: false }),
    );
    return (rows ?? [])
      .map((r) => {
        // PostgREST types an embedded resource as an array; a to-one join like
        // this one comes back as a single row at runtime. Accept both.
        const embedded: unknown = (r as { listings?: unknown }).listings;
        const row = Array.isArray(embedded) ? embedded[0] : embedded;
        return mapRow<Listing>(row as Record<string, unknown> | null);
      })
      .filter((l): l is Listing => !!l);
  },
  async watchListing(listingId: string): Promise<void> {
    await run(
      sb()
        .from('watchlist')
        // Re-watching an already-watched car must not blow up on the PK.
        .upsert({ profile_id: me(), listing_id: listingId }, { onConflict: 'profile_id,listing_id' })
        .select('listing_id'),
    );
  },
  async unwatchListing(listingId: string): Promise<void> {
    await run(
      sb()
        .from('watchlist')
        .delete()
        .eq('profile_id', me())
        .eq('listing_id', listingId)
        .select('listing_id'),
    );
  },

  // --- Verification ------------------------------------------------------
  async listVerificationDocuments(): Promise<VerificationDocument[]> {
    return mapRows<VerificationDocument>(
      await run(sb().from('verification_documents').select('*').eq('profile_id', me())),
    );
  },
  /**
   * Upload a real KYC document to the private `kyc-documents` bucket and record
   * it for review. Stores the storage path (not a public URL) — admins view it
   * through a short-lived signed URL. Re-uploading a type replaces the file and
   * resets it to pending.
   */
  async uploadVerificationDocument(
    type: VerificationDocType,
    file: File,
  ): Promise<VerificationDocument> {
    const uid = me();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${uid}/${type}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb()
      .storage.from('kyc-documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const existing = await run(
      sb()
        .from('verification_documents')
        .select('id, storage_path')
        .eq('profile_id', uid)
        .eq('type', type)
        .maybeSingle(),
    );
    const fields = {
      profile_id: uid,
      type,
      status: 'pending' as const,
      file_name: file.name,
      storage_path: path,
      uploaded_at: new Date().toISOString().slice(0, 10),
      note: null,
      reviewed_by: null,
      reviewed_at: null,
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
    // Best-effort cleanup of the file this one replaced.
    const oldPath = (existing as { storage_path?: string } | null)?.storage_path;
    if (oldPath && oldPath !== path) {
      await sb().storage.from('kyc-documents').remove([oldPath]);
    }
    return mapRow<VerificationDocument>(row) as VerificationDocument;
  },

  // --- Admin -------------------------------------------------------------
  /**
   * Grouped KYC review queue — one row per PERSON who has documents (not one
   * per document), with pending/total counts. `scope: 'pending'` shows only
   * people with something awaiting review; 'all' shows everyone who uploaded.
   * Paginated + searchable by name/email. Admin-only (RPC checks is_admin()).
   */
  async listVerificationProfiles(opts: {
    scope?: 'pending' | 'all';
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<Page<KycProfile>> {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 20;
    const rows = (await run(
      sb().rpc('admin_kyc_profiles', {
        p_scope: opts.scope ?? 'pending',
        p_search: opts.search?.trim() ?? '',
        p_limit: pageSize,
        p_offset: page * pageSize,
      }),
    )) as Record<string, unknown>[] | null;
    const list = rows ?? [];
    const total = list.length ? Number(list[0].total_count ?? 0) : 0;
    const items: KycProfile[] = list.map((r) => ({
      id: r.id as string,
      fullName: r.full_name as string,
      email: r.email as string,
      avatarUrl: (r.avatar_url as string) ?? undefined,
      role: r.role as KycProfile['role'],
      ownerType: (r.owner_type as KycProfile['ownerType']) ?? undefined,
      verification: r.verification as KycProfile['verification'],
      verificationOverride: Boolean(r.verification_override),
      pendingCount: Number(r.pending_count ?? 0),
      docCount: Number(r.doc_count ?? 0),
    }));
    return { items, total };
  },
  /** All KYC documents for one person, for the expanded review card. */
  async listVerificationsForProfile(profileId: string): Promise<VerificationReviewItem[]> {
    const rows = await run(
      sb()
        .from('verification_documents')
        .select(
          '*, owner:profiles!verification_documents_profile_id_fkey(id, full_name, email, avatar_url, role, owner_type)',
        )
        .eq('profile_id', profileId)
        .order('type'),
    );
    return (rows as Record<string, unknown>[] ?? []).map((r) => {
      const owner = mapRow<VerificationReviewItem['owner']>(r.owner as Record<string, unknown>);
      const doc = mapRow<VerificationReviewItem>({ ...r, owner: undefined });
      return { ...(doc as VerificationReviewItem), owner: owner as VerificationReviewItem['owner'] };
    });
  },
  /** Force a user's verification to a value (sticky admin override). */
  async overrideProfileVerification(
    profileId: string,
    status: VerificationStatus,
    note?: string,
  ): Promise<void> {
    await run(
      sb().rpc('admin_set_verification', {
        p_profile_id: profileId,
        p_status: status,
        p_note: note ?? null,
      }),
    );
  },
  /** Remove an override and resume automatic status from the documents. */
  async clearVerificationOverride(profileId: string): Promise<void> {
    await run(sb().rpc('admin_clear_verification_override', { p_profile_id: profileId }));
  },
  /** Whether new KYC submissions are auto-approved (vs. manual review). */
  async getKycAutoApprove(): Promise<boolean> {
    const row = await run(
      sb().from('app_settings').select('kyc_auto_approve').eq('id', 1).maybeSingle(),
    );
    return Boolean((row as { kyc_auto_approve?: boolean } | null)?.kyc_auto_approve);
  },
  /** Turn auto-approve on/off (admin only). */
  async setKycAutoApprove(on: boolean): Promise<void> {
    await run(sb().rpc('admin_set_kyc_auto_approve', { p_on: on }));
  },
  /** Current electric-car quota + whether a non-electric car may be listed now. */
  async getElectricQuota(): Promise<ElectricQuota> {
    const rows = (await run(sb().rpc('electric_quota_status'))) as Record<string, unknown>[] | null;
    const r = rows?.[0];
    return {
      minPercent: Number(r?.min_percent ?? 95),
      totalCars: Number(r?.total_cars ?? 0),
      electricCars: Number(r?.electric_cars ?? 0),
      canAddNonElectric: Boolean(r?.can_add_non_electric),
    };
  },
  /** Set the minimum electric-car percentage (admin only). */
  async setElectricMinPercent(percent: number): Promise<void> {
    await run(sb().rpc('admin_set_electric_min_percent', { p_pct: percent }));
  },
  /** Paginated, searchable user directory (admin only). */
  async listUsers(opts: { search?: string; page?: number; pageSize?: number } = {}): Promise<
    Page<AdminUser>
  > {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 20;
    const rows = (await run(
      sb().rpc('admin_list_users', {
        p_search: opts.search?.trim() ?? '',
        p_limit: pageSize,
        p_offset: page * pageSize,
      }),
    )) as Record<string, unknown>[] | null;
    const list = rows ?? [];
    const total = list.length ? Number(list[0].total_count ?? 0) : 0;
    const items: AdminUser[] = list.map((r) => ({
      id: r.id as string,
      fullName: r.full_name as string,
      email: r.email as string,
      phone: (r.phone as string) ?? undefined,
      avatarUrl: (r.avatar_url as string) ?? undefined,
      role: r.role as AdminUser['role'],
      ownerType: (r.owner_type as AdminUser['ownerType']) ?? undefined,
      verification: r.verification as AdminUser['verification'],
      suspended: Boolean(r.suspended),
      joinedAt: (r.joined_at as string) ?? undefined,
      listingCount: Number(r.listing_count ?? 0),
      bookingCount: Number(r.booking_count ?? 0),
    }));
    return { items, total };
  },
  /** Suspend or reinstate a user (admin only). */
  async setUserSuspended(profileId: string, suspended: boolean): Promise<void> {
    await run(sb().rpc('admin_set_suspended', { p_profile_id: profileId, p_suspended: suspended }));
  },
  /** Send a message (delivered as a notification) to a user (admin only). */
  async sendUserMessage(profileId: string, title: string, body: string): Promise<void> {
    await run(
      sb().rpc('admin_send_message', { p_profile_id: profileId, p_title: title, p_body: body }),
    );
  },
  /** Send a warning to a user (notification + recorded action; admin only). */
  async warnUser(profileId: string, message: string): Promise<void> {
    await run(sb().rpc('admin_warn_user', { p_profile_id: profileId, p_message: message }));
  },
  /** A user's listings (cars/machines they host). */
  async listUserListings(hostId: string): Promise<Listing[]> {
    return mapRows<Listing>(
      await run(sb().from('listings').select('*').eq('host_id', hostId).order('id')),
    );
  },
  /** Bookings placed on a specific listing (admin reads all via RLS). */
  async listListingBookings(listingId: string): Promise<Booking[]> {
    return mapRows<Booking>(
      await run(
        sb()
          .from('bookings')
          .select('*')
          .eq('listing_id', listingId)
          .order('created_at', { ascending: false }),
      ),
    );
  },
  /** Permanently delete a user (admin only) via the admin-delete-user function. */
  async deleteUser(profileId: string): Promise<void> {
    const { data, error } = await getSupabase().functions.invoke('admin-delete-user', {
      body: { profileId },
    });
    if (error) throw await fnError(error);
    const payload = data as { error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
  },
  /** A user's bookings as renter or host, with the car title (admin reads all). */
  async listUserBookings(userId: string): Promise<(Booking & { carTitle?: string })[]> {
    const rows = await run(
      sb()
        .from('bookings')
        .select('*, listing:listings(title, make, model)')
        .or(`renter_id.eq.${userId},host_id.eq.${userId}`)
        .order('created_at', { ascending: false }),
    );
    return (rows as Record<string, unknown>[] ?? []).map((r) => {
      const listing = r.listing as { title?: string } | null;
      const b = mapRow<Booking>({ ...r, listing: undefined }) as Booking;
      return { ...b, carTitle: listing?.title };
    });
  },
  /** Recorded admin actions taken on a user (admin only). */
  async listUserActions(profileId: string): Promise<AdminAction[]> {
    const rows = (await run(
      sb().from('admin_actions').select('*').eq('target_id', profileId).order('created_at', { ascending: false }),
    )) as Record<string, unknown>[] | null;
    const list = rows ?? [];
    const adminIds = [...new Set(list.map((r) => r.admin_id).filter(Boolean) as string[])];
    const admins = adminIds.length ? await this.getProfilesByIds(adminIds) : {};
    return list.map((r) => ({
      id: Number(r.id),
      adminId: (r.admin_id as string) ?? undefined,
      targetId: r.target_id as string,
      action: r.action as string,
      detail: (r.detail as string) ?? undefined,
      createdAt: r.created_at as string,
      adminName: r.admin_id ? admins[r.admin_id as string]?.fullName : undefined,
    }));
  },
  /**
   * KYC activity feed — every submit/approve/reject, newest first, paginated.
   * verification_events has no FK to profiles (history outlives a deleted
   * profile), so owner + actor names are resolved in one batch lookup here.
   */
  async listKycEvents(opts: { profileId?: string; page?: number; pageSize?: number } = {}): Promise<
    Page<VerificationEvent>
  > {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 30;
    let q = sb().from('verification_events').select('*', { count: 'exact' });
    if (opts.profileId) q = q.eq('profile_id', opts.profileId);
    const from = page * pageSize;
    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data as Record<string, unknown>[]) ?? [];
    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.profile_id, r.actor_id]).filter(Boolean) as string[],
      ),
    ];
    const profiles = ids.length ? await this.getProfilesByIds(ids) : {};
    const toOwner = (p?: UserProfile & Partial<Host>): KycOwner | undefined =>
      p && {
        id: p.id,
        fullName: p.fullName,
        email: p.email,
        avatarUrl: p.avatarUrl,
        role: p.role,
        ownerType: p.ownerType,
      };
    const items = rows.map((r) => {
      const ev = mapRow<VerificationEvent>(r) as VerificationEvent;
      return {
        ...ev,
        owner: toOwner(profiles[ev.profileId]),
        actorName: ev.actorId ? profiles[ev.actorId]?.fullName : undefined,
      };
    });
    return { items, total: count ?? 0 };
  },
  /** Aggregate KYC counts for the admin overview (cheap head/count queries). */
  async getKycMetrics(): Promise<KycMetrics> {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const countOf = (
      builder: PromiseLike<{ count: number | null; error: { message: string } | null }>,
    ) => builder.then(({ count }) => count ?? 0);
    const [pendingDocs, verified, pending, rejected, unverified, decisions7d] = await Promise.all([
      countOf(sb().from('verification_documents').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'verified')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'pending')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'rejected')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'unverified')),
      countOf(sb().from('verification_events').select('id', { count: 'exact', head: true }).in('event', ['approved', 'rejected']).gte('created_at', weekAgo)),
    ]);
    return {
      pendingDocs,
      verifiedUsers: verified,
      pendingUsers: pending,
      rejectedUsers: rejected,
      unverifiedUsers: unverified,
      decisions7d,
    };
  },
  /** Approve or reject a document; the DB trigger re-derives profiles.verification. */
  async reviewVerificationDocument(
    id: string,
    status: 'verified' | 'rejected',
    note?: string,
  ): Promise<VerificationDocument> {
    const row = await run(
      sb()
        .from('verification_documents')
        .update({
          status,
          note: note ?? null,
          reviewed_by: me(),
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single(),
    );
    return mapRow<VerificationDocument>(row) as VerificationDocument;
  },
  /** Short-lived signed URL to view a KYC document (admin reads the private bucket). */
  async getKycDocumentUrl(storagePath: string): Promise<string> {
    const { data, error } = await sb()
      .storage.from('kyc-documents')
      .createSignedUrl(storagePath, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
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
      sb().from('public_profiles').select('id', { count: 'exact', head: true }).not('owner_type', 'is', null),
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
    /** ISO 3166-1 alpha-2 — where they pay from / are paid into. */
    country?: string;
  }): Promise<UserProfile> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.fullName !== undefined) dbPatch.full_name = patch.fullName;
    if (patch.businessName !== undefined) dbPatch.business_name = patch.businessName;
    if (patch.avatarUrl !== undefined) dbPatch.avatar_url = patch.avatarUrl;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    if (patch.ownerType !== undefined) dbPatch.owner_type = patch.ownerType;
    if (patch.country !== undefined) dbPatch.country = patch.country.toUpperCase();
    const row = await run(
      sb().from('profiles').update(dbPatch).eq('id', me()).select('*').single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /**
   * Connect a host payout method. The host picks a method (momo/bank/card) and a
   * destination; the caller routes it to a provider (Flutterwave/Stripe) and
   * passes both. In a live build this kicks off provider onboarding server-side
   * and status becomes 'active' only once the provider confirms via webhook; the
   * demo marks it active immediately. Only the MASKED destination is stored.
   */
  async setPayoutMethod(input: {
    method: PayoutMethodType;
    provider: PayoutProvider;
    destinationMasked: string;
    label: string;
  }): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payout_method: input.method,
          payout_provider: input.provider,
          payout_destination: input.destinationMasked,
          payout_label: input.label,
          payout_status: 'active',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /**
   * Save a renter's payment method — how they pay, the mirror of
   * `setPayoutMethod`. Only the MASKED destination is stored; the real
   * credentials belong to the payment provider, never to us. `ref` is that
   * provider's token for the method, absent until the external payment system
   * is connected (nothing in AutoHire mints one), which is why the status stays
   * 'pending' without it — an unbacked method can't actually be charged.
   */
  async setPaymentMethod(input: {
    method: PaymentMethodType;
    destinationMasked: string;
    label: string;
    ref?: string;
  }): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payment_method: input.method,
          payment_destination: input.destinationMasked,
          payment_label: input.label,
          payment_ref: input.ref ?? null,
          payment_status: input.ref ? 'active' : 'pending',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /** Remove the saved payment method. */
  async clearPaymentMethod(): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payment_method: null,
          payment_destination: null,
          payment_label: null,
          payment_ref: null,
          payment_status: 'none',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /** Remove the connected payout method. */
  async clearPayoutMethod(): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payout_method: null,
          payout_provider: null,
          payout_destination: null,
          payout_label: null,
          payout_status: 'none',
        })
        .eq('id', me())
        .select('*')
        .single(),
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

  // --- Social: follows -----------------------------------------------------
  /**
   * `follows` holds ids only (migration 059), so this is a cheap direct read —
   * no RPC needed. Never join `profiles` here; it's locked to counterparties
   * since migration 029. `public_profiles` is the PII-free view built for
   * exactly this.
   */
  async listFollowing(profileId?: string): Promise<PublicProfile[]> {
    const rows = await run(
      sb().from('follows').select('followee_id').eq('follower_id', profileId ?? me()),
    );
    const ids = (rows ?? []).map((r) => r.followee_id as string);
    if (ids.length === 0) return [];
    return mapRows<PublicProfile>(
      await run(sb().from('public_profiles').select('*').in('id', ids)),
    );
  },
  async listFollowers(profileId?: string): Promise<PublicProfile[]> {
    const rows = await run(
      sb().from('follows').select('follower_id').eq('followee_id', profileId ?? me()),
    );
    const ids = (rows ?? []).map((r) => r.follower_id as string);
    if (ids.length === 0) return [];
    return mapRows<PublicProfile>(
      await run(sb().from('public_profiles').select('*').in('id', ids)),
    );
  },
  async isFollowing(profileId: string): Promise<boolean> {
    const row = await run(
      sb()
        .from('follows')
        .select('follower_id')
        .eq('follower_id', me())
        .eq('followee_id', profileId)
        .maybeSingle(),
    );
    return !!row;
  },
  async follow(profileId: string): Promise<void> {
    await run(
      sb().from('follows').upsert(
        { follower_id: me(), followee_id: profileId },
        { onConflict: 'follower_id,followee_id' },
      ),
    );
  },
  async unfollow(profileId: string): Promise<void> {
    await run(
      sb().from('follows').delete().eq('follower_id', me()).eq('followee_id', profileId),
    );
  },

  // --- Social: proof ---------------------------------------------------------
  /**
   * "Trusted by N you follow" for a listing. Two RPCs because they carry
   * different disclosure: the per-renter list only exists inside
   * `social_proof_for_listing` (migration 060) precisely because it can only
   * ever name people the CALLER already follows — never a stranger's renters.
   */
  async socialProof(listingId: string): Promise<SocialProof> {
    const [renters, total] = await Promise.all([
      run(sb().rpc('social_proof_for_listing', { p_listing_id: listingId })),
      run(sb().rpc('total_completed_trips', { p_listing_id: listingId })),
    ]);
    const rows = (renters ?? []) as { renter_id: string; full_name: string; avatar_url: string | null }[];
    return {
      listingId,
      circleRenters: rows.map((r) => ({
        id: r.renter_id,
        fullName: r.full_name,
        avatarUrl: r.avatar_url ?? undefined,
        role: 'renter' as const,
        joinedAt: '',
        verification: 'verified' as const,
      })),
      totalTrips: Number(total ?? 0),
    };
  },

  // --- Social: circles -----------------------------------------------------
  /** Circles you're a member of — any status, including a pending invite. */
  async listCircles(): Promise<Circle[]> {
    const membership = await run(
      sb().from('circle_members').select('circle_id, status').eq('profile_id', me()),
    );
    const ids = (membership ?? []).map((m) => m.circle_id as string);
    if (ids.length === 0) return [];
    const statusById = new Map((membership ?? []).map((m) => [m.circle_id as string, m.status as string]));

    const [circleRows, activeMembers] = await Promise.all([
      run(sb().from('circles').select('*').in('id', ids)),
      run(sb().from('circle_members').select('circle_id').eq('status', 'active').in('circle_id', ids)),
    ]);
    const countByCircle = new Map<string, number>();
    for (const row of activeMembers ?? []) {
      const cid = row.circle_id as string;
      countByCircle.set(cid, (countByCircle.get(cid) ?? 0) + 1);
    }

    return mapRows<Circle>(circleRows).map((c) => ({
      ...c,
      memberCount: countByCircle.get(c.id) ?? 0,
      myStatus: statusById.get(c.id) as Circle['myStatus'],
    }));
  },
  async getCircle(id: string): Promise<Circle | undefined> {
    const row = await run(sb().from('circles').select('*').eq('id', id).maybeSingle());
    if (!row) return undefined;
    const activeMembers = await run(
      sb().from('circle_members').select('profile_id, status').eq('circle_id', id),
    );
    const mine = (activeMembers ?? []).find((m) => m.profile_id === me());
    const memberCount = (activeMembers ?? []).filter((m) => m.status === 'active').length;
    return { ...(mapRow<Circle>(row) as Circle), memberCount, myStatus: mine?.status as Circle['myStatus'] };
  },
  /** Creates the circle and seeds the caller as its active owner-member. */
  async createCircle(input: { name: string; kind: CircleKind; country?: string }): Promise<Circle> {
    const id = `circle-${Date.now()}`;
    await run(
      sb()
        .from('circles')
        .insert({ id, name: input.name, kind: input.kind, created_by: me(), country: input.country ?? null }),
    );
    await run(
      sb()
        .from('circle_members')
        .insert({ circle_id: id, profile_id: me(), role: 'owner', status: 'active' }),
    );
    return (await this.getCircle(id)) as Circle;
  },
  async listCircleMembers(circleId: string): Promise<CircleMember[]> {
    const rows = await run(
      sb()
        .from('circle_members')
        .select('circle_id, profile_id, role, status, joined_at')
        .eq('circle_id', circleId),
    );
    const ids = (rows ?? []).map((r) => r.profile_id as string);
    if (ids.length === 0) return [];
    const profiles = mapRows<PublicProfile>(
      await run(sb().from('public_profiles').select('*').in('id', ids)),
    );
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? [])
      .map((r) => {
        const profile = byId.get(r.profile_id as string);
        if (!profile) return null;
        return {
          circleId: r.circle_id as string,
          profile,
          role: r.role as CircleMember['role'],
          status: r.status as CircleMember['status'],
          joinedAt: r.joined_at as string,
        };
      })
      .filter((m): m is CircleMember => !!m);
  },
  /** Leaving deletes your membership row outright — there's no "left" limbo to manage. */
  async leaveCircle(circleId: string): Promise<void> {
    await run(
      sb().from('circle_members').delete().eq('circle_id', circleId).eq('profile_id', me()),
    );
  },
  /**
   * A share-link invite. The token is the credential (migration 063) — anyone
   * who opens it while signed in can claim membership, once. Build the actual
   * URL at the call site (`${origin}/invite/${token}`); the client only hands
   * back the token.
   */
  async createCircleInviteLink(circleId: string): Promise<CircleInvite> {
    const id = `cinv-${Date.now()}`;
    const token = crypto.randomUUID();
    const row = await run(
      sb()
        .from('circle_invites')
        .insert({ id, circle_id: circleId, invited_by: me(), token })
        .select('*')
        .single(),
    );
    return mapRow<CircleInvite>(row) as CircleInvite;
  },
  /** Returns the joined circle's id, or null if the token was invalid or already used. */
  async claimCircleInvite(token: string): Promise<string | null> {
    const result = await run(sb().rpc('claim_circle_invite', { p_token: token }));
    return (result as unknown as string) ?? null;
  },

  // --- Social: boards --------------------------------------------------------
  /** Boards visible to you: your own, plus any circle's you belong to (RLS-scoped). */
  async listBoards(circleId?: string): Promise<Board[]> {
    let q = sb().from('boards').select('*, board_items(count)');
    if (circleId) q = q.eq('circle_id', circleId);
    const rows = await run(q);
    return (rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const items = row.board_items as { count: number }[] | undefined;
      const board = mapRow<Board>(row) as Board;
      return { ...board, itemCount: items?.[0]?.count ?? 0 };
    });
  },
  async getBoard(id: string): Promise<Board | undefined> {
    const row = await run(
      sb().from('boards').select('*, board_items(count)').eq('id', id).maybeSingle(),
    );
    if (!row) return undefined;
    const items = (row as Record<string, unknown>).board_items as { count: number }[] | undefined;
    return { ...(mapRow<Board>(row) as Board), itemCount: items?.[0]?.count ?? 0 };
  },
  async createBoard(input: { title: string; circleId?: string; isPublic?: boolean }): Promise<Board> {
    const id = `board-${Date.now()}`;
    const row = await run(
      sb()
        .from('boards')
        .insert({
          id,
          title: input.title,
          created_by: me(),
          circle_id: input.circleId ?? null,
          is_public: input.isPublic ?? false,
        })
        .select('*')
        .single(),
    );
    return { ...(mapRow<Board>(row) as Board), itemCount: 0 };
  },
  async listBoardItems(boardId: string): Promise<BoardItem[]> {
    const rows = await run(
      sb()
        .from('board_items')
        .select('board_id, listing_id, added_by, note, target_start, target_end, created_at, listings(*)')
        .eq('board_id', boardId)
        .order('created_at', { ascending: false }),
    );
    const addedByIds = [...new Set((rows ?? []).map((r) => r.added_by as string))];
    const profiles = addedByIds.length
      ? mapRows<PublicProfile>(await run(sb().from('public_profiles').select('*').in('id', addedByIds)))
      : [];
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? [])
      .map((r): BoardItem | null => {
        const row = r as Record<string, unknown>;
        const embedded = row.listings;
        const listingRow = Array.isArray(embedded) ? embedded[0] : embedded;
        const listing = mapRow<Listing>(listingRow as Record<string, unknown> | null);
        const addedBy = profileById.get(row.added_by as string);
        if (!listing || !addedBy) return null;
        return {
          boardId: row.board_id as string,
          listing,
          addedBy,
          note: (row.note as string | null) ?? undefined,
          targetStart: (row.target_start as string | null) ?? undefined,
          targetEnd: (row.target_end as string | null) ?? undefined,
          createdAt: row.created_at as string,
        };
      })
      .filter((i): i is BoardItem => !!i);
  },
  async addToBoard(input: {
    boardId: string;
    listingId: string;
    note?: string;
    targetStart?: string;
    targetEnd?: string;
  }): Promise<void> {
    await run(
      sb()
        .from('board_items')
        .upsert(
          {
            board_id: input.boardId,
            listing_id: input.listingId,
            added_by: me(),
            note: input.note ?? null,
            target_start: input.targetStart ?? null,
            target_end: input.targetEnd ?? null,
          },
          { onConflict: 'board_id,listing_id' },
        ),
    );
  },
  async removeFromBoard(boardId: string, listingId: string): Promise<void> {
    await run(
      sb().from('board_items').delete().eq('board_id', boardId).eq('listing_id', listingId),
    );
  },
  /** Forward-looking demand for a car — how many boards have pinned it, by target date. */
  async listingDemand(listingId: string): Promise<ListingDemand[]> {
    return mapRows<ListingDemand>(
      await run(sb().from('listing_demand').select('*').eq('listing_id', listingId)),
    );
  },

  // --- Social: feed --------------------------------------------------------
  /**
   * The verified feed. RLS (trip_posts_read, migration 064) already decides
   * what comes back — public posts, your own, and circle-shared posts from
   * people you share a circle with — so this is a plain select, no manual
   * filtering. `authorId` narrows it to one person's posts (a future host
   * storefront section); omit it for the main feed.
   */
  async listFeed(opts: { authorId?: string; bookingId?: string } = {}): Promise<FeedItem[]> {
    let postsQ = sb()
      .from('trip_posts')
      .select('id, author_id, booking_id, listing_id, body, photos, visibility, city, country, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (opts.authorId) postsQ = postsQ.eq('author_id', opts.authorId);
    if (opts.bookingId) postsQ = postsQ.eq('booking_id', opts.bookingId);

    // Broadcasts have no booking to filter by, and an authorId filter means
    // "this trip", not "this host" — bookingId scopes them out entirely.
    const wantBroadcasts = !opts.bookingId;
    let broadcastsQ = sb()
      .from('host_broadcasts')
      .select('id, host_id, body, listing_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (opts.authorId) broadcastsQ = broadcastsQ.eq('host_id', opts.authorId);

    const [postRows, broadcastRows] = await Promise.all([
      run(postsQ),
      wantBroadcasts ? run(broadcastsQ) : Promise.resolve([] as Record<string, unknown>[]),
    ]);
    const [posts, broadcasts] = await Promise.all([
      hydratePosts(postRows),
      hydrateBroadcasts(broadcastRows),
    ]);

    const items: FeedItem[] = [
      ...posts.map((p): FeedItem => ({ kind: 'trip', ...p })),
      ...broadcasts.map((b): FeedItem => ({ kind: 'broadcast', ...b })),
    ];
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  /**
   * A fresh id for a post that will carry photos — generate it BEFORE
   * uploading, since trip-photos' path convention (migration 066) is
   * `<author_id>/<post_id>/<file>` and the post row doesn't exist yet at
   * upload time.
   */
  newTripPostId(): string {
    return `post-${Date.now()}`;
  },
  /** Uploads one photo for a not-yet-created post; returns the storage path to pass as `photos`. */
  async uploadTripPostPhoto(postId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${me()}/${postId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb()
      .storage.from('trip-photos')
      .upload(path, file, { contentType: file.type });
    if (error) throw new Error(error.message);
    return path;
  },
  /**
   * Post about a completed trip. `trip_post_guard` (migration 064) is the
   * real gate — it refuses anything not anchored to a paid, completed booking
   * the caller was actually on — so this is a plain insert, not a place to
   * duplicate that check client-side. Pass `id` from `newTripPostId()` when
   * the post carries photos uploaded under that id; omit it for a text-only
   * post.
   */
  async createTripPost(input: {
    id?: string;
    bookingId: string;
    body: string;
    photos?: string[];
    visibility?: PostVisibility;
  }): Promise<TripPost> {
    const id = input.id ?? `post-${Date.now()}`;
    const row = await run(
      sb()
        .from('trip_posts')
        .insert({
          id,
          author_id: me(),
          booking_id: input.bookingId,
          body: input.body,
          photos: input.photos ?? [],
          visibility: input.visibility ?? 'circles',
        })
        .select('id, author_id, booking_id, listing_id, body, photos, visibility, city, country, created_at')
        .single(),
    );
    const [post] = await hydratePosts(row ? [row] : []);
    return post;
  },
  async deleteTripPost(id: string): Promise<void> {
    await run(sb().from('trip_posts').delete().eq('id', id).eq('author_id', me()));
  },

  // --- Social: host broadcasts ----------------------------------------------
  /**
   * Un-anchored fleet announcements (migration 067) — no booking required,
   * publicly readable. `host_broadcast_guard` refuses a non-host account or a
   * listing that isn't actually the caller's, so this is a plain insert.
   */
  async createHostBroadcast(input: { body: string; listingId?: string }): Promise<HostBroadcast> {
    const id = `bcast-${Date.now()}`;
    const row = await run(
      sb()
        .from('host_broadcasts')
        .insert({ id, host_id: me(), body: input.body, listing_id: input.listingId ?? null })
        .select('id, host_id, body, listing_id, created_at')
        .single(),
    );
    const [b] = await hydrateBroadcasts(row ? [row] : []);
    return b;
  },
  /** A host's own broadcast history, newest first — used on their public profile. */
  async listHostBroadcasts(hostId: string): Promise<HostBroadcast[]> {
    const rows = await run(
      sb()
        .from('host_broadcasts')
        .select('id, host_id, body, listing_id, created_at')
        .eq('host_id', hostId)
        .order('created_at', { ascending: false })
        .limit(20),
    );
    return hydrateBroadcasts(rows);
  },
  async deleteHostBroadcast(id: string): Promise<void> {
    await run(sb().from('host_broadcasts').delete().eq('id', id).eq('host_id', me()));
  },
};
