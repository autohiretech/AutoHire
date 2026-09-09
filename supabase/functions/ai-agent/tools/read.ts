// AutoHire — ai-agent read tools. Mirrors the read half of
// web/src/lib/supabaseClient.ts — same tables, same filters, run under the
// caller's own JWT so RLS decides what comes back, exactly as it would for
// that user clicking around the app themselves.

import type { ToolDef } from './types.ts';
import { mapRow, mapRows, run } from './db.ts';
import type { BookingSummary, ListingFilters, ListingSummary } from '../types.ts';

const CATEGORIES = ['sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury'];

// Kept in step with `keywordsOf`/`keywordConditions` in
// `web/src/lib/supabaseClient.ts` and with `search_available_listings`
// (migration 076). Words are ANDed, so a token that is nothing but the
// characters we strip — the "," the agent leaves behind whenever it passes a
// place phrase as `query` — is dropped rather than kept as an empty word no
// listing can match. One stray comma zeroing a whole search is a bug, not a
// way of saying "no results".
function keywordsOf(query: string | undefined): string[] {
  return (query ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[%*,()]/g, ''))
    .filter(Boolean);
}
function keywordConditions(word: string): string {
  const t = `%${word}%`;
  return `title.ilike.${t},make.ilike.${t},model.ilike.${t},city.ilike.${t},location.ilike.${t}`;
}

/** Plain rows for an ordinary search; the `{ listings, note }` form only when
 * `run` had to overrule the caller — a city dropped in favour of the renter's
 * own coordinate, or a `nearMe` there was no location to honour. `loop.ts`
 * hands the whole result back to the model as the tool_result, so an
 * overruled search reports itself instead of being read as a plain answer. */
type ListingSearchResult = ListingSummary[] | { listings: ListingSummary[]; note: string };

export const listListingsTool: ToolDef<ListingFilters & { nearMe?: boolean }, ListingSearchResult> = {
  name: 'list_listings',
  description:
    "Search AutoHire's listings with the same filters the browse page uses. Call this before booking, " +
    'messaging, or watchlisting a car you only know by description — resolve it to a real listing id first.',
  input_schema: {
    type: 'object',
    properties: {
      country: { type: 'string', description: "ISO 3166-1 alpha-2 market, e.g. 'RW'." },
      city: {
        type: 'string',
        description:
          'A city the renter actually named. A hard boundary — every other city is excluded outright — so ' +
          'do not send one with `nearMe`, and never derive one from where the renter happens to be.',
      },
      category: { type: 'string', enum: CATEGORIES },
      ownerType: { type: 'string', enum: ['individual', 'business'] },
      transmission: { type: 'string', enum: ['automatic', 'manual'] },
      fuel: { type: 'string', enum: ['petrol', 'diesel', 'electric', 'hybrid'] },
      minSeats: { type: 'integer' },
      maxPriceRwf: { type: 'integer' },
      query: {
        type: 'string',
        description:
          'Free text describing the CAR — make, model, title words. Never a place: every word here has to ' +
          'match the same listing, so an address phrase ("Gasabo District, City of Kigali") matches nothing. ' +
          'A place is `city`, or `nearMe` when it is where the renter is.',
      },
      startDate: {
        type: 'string',
        description: 'Pickup date, YYYY-MM-DD. With endDate, returns only cars actually free across that range.',
      },
      endDate: { type: 'string', description: 'Return date, YYYY-MM-DD. Use with startDate.' },
      nearMe: {
        type: 'boolean',
        description:
          "Rank results by real distance from the renter's own location, nearest first. Only has an effect when their location is known — the system prompt says whether it is. Their coordinate replaces `city` rather than joining it, so do not send both.",
      },
    },
  },
  scope: 'any',
  effect: 'read',
  // The step line is what the renter watches while this runs, so it must not
  // name a city `run` dropped or promise a distance ranking that never
  // happened. A `note` on the result — i.e. anything but a plain array — is
  // exactly the signal that one of those two things occurred, so both claims
  // are withheld in that case. `result` is `undefined` when a summary is
  // rendered before execution, which lands on the same conservative branch.
  summary: (input, result) => {
    const overruled = !Array.isArray(result);
    return `Searching listings${input.query ? ` for "${input.query}"` : ''}` +
      `${!overruled && input.city ? ` in ${input.city}` : ''}` +
      `${!overruled && input.nearMe ? ', nearest first' : ''}`;
  },
  async run(ctx, input) {
    // Availability and distance are not things to re-derive here — the same
    // `search_available_listings` function the browse page calls already does
    // both in Postgres (migrations 074/075: booked-range exclusion, haversine
    // ordering). Route through it whenever either applies, and fall through
    // to the plain query when neither does, so results stay identical to
    // before for an ordinary search.
    const wantsDates = Boolean(input.startDate && input.endDate);
    const near = input.nearMe ? ctx.userLocation : undefined;
    // Where the renter is standing beats the name of the city they are
    // standing in. `p_city` is `listings.city = p_city` in the RPC — a hard
    // boundary — so a city passed alongside the coordinate throws away
    // precisely the cars "near me" is asking about: the ones a few minutes
    // away on the other side of a district line. Distance only orders
    // (migration 075) and excludes nothing, so the coordinate takes the
    // city's place instead of narrowing inside it. Decided here rather than
    // asked for in the prompt, because the model reads a district name in
    // its own location line and reaches for it.
    const city = near ? null : input.city ?? null;
    const droppedCity = near && input.city ? input.city : undefined;
    // A `nearMe` we cannot honour must not pass for one we did. Left silent,
    // the model reads an ordinary rating-ordered list as "the closest cars"
    // and answers a question nothing actually answered.
    const unlocated = Boolean(input.nearMe) && !near;

    // The search itself is unchanged apart from `city` — same two paths, same
    // RPC arguments, same fall-through for an ordinary search.
    const search = async (): Promise<ListingSummary[]> => {
      if (wantsDates || near) {
        const rows = await run(
          ctx.supabase.rpc('search_available_listings', {
            p_country: input.country ?? null,
            p_city: city,
            p_category: input.category ?? null,
            p_owner_type: input.ownerType ?? null,
            p_transmission: input.transmission ?? null,
            p_fuel: input.fuel ?? null,
            p_min_seats: input.minSeats ?? null,
            p_max_price_rwf: input.maxPriceRwf ?? null,
            p_query: input.query ?? null,
            p_start_date: wantsDates ? input.startDate : null,
            p_end_date: wantsDates ? input.endDate : null,
            p_near_lat: near ? near.lat : null,
            p_near_lng: near ? near.lng : null,
          }),
        );
        return mapRows<ListingSummary>((rows as Record<string, unknown>[]).slice(0, 20));
      }
      let q = ctx.supabase.from('listings').select('*');
      if (input.country) q = q.eq('country', input.country);
      if (city) q = q.eq('city', city);
      if (input.category) q = q.eq('category', input.category);
      if (input.ownerType) q = q.eq('owner_type', input.ownerType);
      if (input.transmission) q = q.eq('transmission', input.transmission);
      if (input.fuel) q = q.eq('fuel', input.fuel);
      if (input.minSeats) q = q.gte('seats', input.minSeats);
      if (input.maxPriceRwf) q = q.lte('price_per_day_rwf', input.maxPriceRwf);
      for (const word of keywordsOf(input.query)) q = q.or(keywordConditions(word));
      const ordered = q.order('rating_avg', { ascending: false }).order('id', { ascending: true }).limit(20);
      return mapRows<ListingSummary>(await run(ordered));
    };

    const listings = await search();
    if (droppedCity) {
      return {
        listings,
        note:
          `The city filter "${droppedCity}" was dropped: the renter's own coordinate replaces it, so the ` +
          'cars just outside that city are still here rather than cut away by its boundary. These are ' +
          'ranked by distance from where they actually are — describe them that way, not as cars in that city.',
      };
    }
    if (unlocated) {
      return {
        listings,
        note:
          "nearMe had no effect: the renter's location is not known, so these are ordered by rating, NOT by " +
          'distance. Do not call any of them the closest or the nearest — tell them you need their location, ' +
          'or ask them to name a place.',
      };
    }
    return listings;
  },
};

export const getListingTool: ToolDef<{ listingId: string }, ListingSummary | undefined> = {
  name: 'get_listing',
  description: 'Look up one listing by id — its full detail, not just the search-result summary.',
  input_schema: {
    type: 'object',
    properties: { listingId: { type: 'string' } },
    required: ['listingId'],
  },
  scope: 'any',
  effect: 'read',
  summary: (input) => `Looking up listing ${input.listingId}`,
  async run(ctx, input) {
    return mapRow<ListingSummary>(
      await run(ctx.supabase.from('listings').select('*').eq('id', input.listingId).maybeSingle()),
    );
  },
};

export const listMyBookingsTool: ToolDef<Record<string, never>, BookingSummary[]> = {
  name: 'list_my_bookings',
  description: "The signed-in user's own trips (as a renter) — needed before cancelling or reviewing one.",
  input_schema: { type: 'object', properties: {} },
  scope: 'renter',
  effect: 'read',
  summary: () => 'Checking your trips',
  async run(ctx) {
    return mapRows<BookingSummary>(
      await run(
        ctx.supabase.from('bookings').select('*').eq('renter_id', ctx.userId)
          .order('created_at', { ascending: false }).limit(20),
      ),
    );
  },
};

export const getBookingTool: ToolDef<{ bookingId: string }, BookingSummary | undefined> = {
  name: 'get_booking',
  description: 'Look up one booking by id (RLS only returns it if the caller is the renter, the host, or an admin).',
  input_schema: {
    type: 'object',
    properties: { bookingId: { type: 'string' } },
    required: ['bookingId'],
  },
  scope: 'any',
  effect: 'read',
  summary: (input) => `Looking up booking ${input.bookingId}`,
  async run(ctx, input) {
    return mapRow<BookingSummary>(
      await run(ctx.supabase.from('bookings').select('*').eq('id', input.bookingId).maybeSingle()),
    );
  },
};

export const listWatchlistTool: ToolDef<Record<string, never>, ListingSummary[]> = {
  name: 'list_watchlist',
  description: "Cars the signed-in user is watching, newest first.",
  input_schema: { type: 'object', properties: {} },
  scope: 'any',
  effect: 'read',
  summary: () => 'Checking your watchlist',
  async run(ctx) {
    const rows = await run(
      ctx.supabase.from('watchlist').select('created_at, listings(*)').eq('profile_id', ctx.userId)
        .order('created_at', { ascending: false }),
    );
    return (rows ?? [])
      .map((r: Record<string, unknown>) => {
        const embedded = r.listings;
        const row = Array.isArray(embedded) ? embedded[0] : embedded;
        return mapRow<ListingSummary>(row as Record<string, unknown> | null);
      })
      .filter((l: ListingSummary | undefined): l is ListingSummary => !!l);
  },
};

export const listConversationsTool: ToolDef<Record<string, never>, unknown[]> = {
  name: 'list_conversations',
  description: "The signed-in user's message threads, most recently active first.",
  input_schema: { type: 'object', properties: {} },
  scope: 'any',
  effect: 'read',
  summary: () => 'Checking your messages',
  async run(ctx) {
    return mapRows(
      await run(ctx.supabase.from('conversations').select('*').order('last_message_at', { ascending: false })),
    );
  },
};

export const getProfileTool: ToolDef<Record<string, never>, unknown> = {
  name: 'get_profile',
  description:
    "The signed-in user's own account — name, verification status, account country, payment/payout method " +
    "summaries. Answer questions like \"am I verified?\" or \"what's my payout method?\" from this, don't guess.",
  input_schema: { type: 'object', properties: {} },
  scope: 'any',
  effect: 'read',
  summary: () => 'Checking your account',
  async run(ctx) {
    return mapRow(await run(ctx.supabase.from('profiles').select('*').eq('id', ctx.userId).maybeSingle()));
  },
};

export const getFxRatesTool: ToolDef<Record<string, never>, { base: string; asOf: string; rates: Record<string, number> }> = {
  name: 'get_fx_rates',
  description: 'Current foreign-exchange rates (quoted against USD) — for converting a price the renter mentions into another currency.',
  input_schema: { type: 'object', properties: {} },
  scope: 'any',
  effect: 'read',
  summary: () => 'Checking exchange rates',
  async run(ctx) {
    const rows = (await run(
      ctx.supabase.from('fx_rates').select('quote, rate, as_of').eq('base', 'USD').order('as_of', { ascending: false }),
    )) as { quote: string; rate: number; as_of: string }[] | null;
    const list = rows ?? [];
    const asOf = list[0]?.as_of ?? new Date().toISOString().slice(0, 10);
    const rates: Record<string, number> = {};
    for (const r of list) if (!(r.quote in rates)) rates[r.quote] = Number(r.rate);
    rates.USD = 1;
    return { base: 'USD', asOf, rates };
  },
};

/**
 * Text → lat/lng via the same free, keyless geocoder the web app already
 * uses client-side (web/src/lib/geocoding.ts → Nominatim, OpenStreetMap).
 * `resolve-maps-link` (the other geocoding-adjacent Edge Function) does a
 * DIFFERENT job — following a shortened Google Maps redirect — and never
 * turns free text into a coordinate itself, so this doesn't call it.
 */
export const resolvePlaceTool: ToolDef<{ text: string }, { lat: number; lng: number; label: string } | null> = {
  name: 'resolve_place',
  description:
    'Turn a place name or address the user typed ("the airport in Kigali", "123 KG 7 Ave") into coordinates, ' +
    'for a "near me" or pickup-location request. Returns null if nothing matched.',
  input_schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  scope: 'any',
  effect: 'read',
  summary: (input) => `Looking up "${input.text}"`,
  async run(_ctx, input) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(input.text)}`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'AutoHire-ai-agent/1.0' } },
    );
    if (!res.ok) return null;
    const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const hit = hits[0];
    if (!hit) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
  },
};

export const READ_TOOLS: ToolDef[] = [
  listListingsTool,
  getListingTool,
  listMyBookingsTool,
  getBookingTool,
  listWatchlistTool,
  listConversationsTool,
  getProfileTool,
  getFxRatesTool,
  resolvePlaceTool,
];
