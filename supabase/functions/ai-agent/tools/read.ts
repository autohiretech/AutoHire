// AutoHire — ai-agent read tools. Mirrors the read half of
// web/src/lib/supabaseClient.ts — same tables, same filters, run under the
// caller's own JWT so RLS decides what comes back, exactly as it would for
// that user clicking around the app themselves.

import type { ToolDef } from './types.ts';
import { mapRow, mapRows, run } from './db.ts';
import type { BookingSummary, ListingFilters, ListingSummary } from '../types.ts';

const CATEGORIES = ['sedan', 'suv', '4x4', 'hatchback', 'pickup', 'van', 'minibus', 'luxury'];

function keywordsOf(query: string | undefined): string[] {
  return (query ?? '').trim().split(/\s+/).filter(Boolean);
}
function keywordConditions(word: string): string {
  const safe = word.replace(/[%*,()]/g, '');
  if (!safe) return 'id.eq.__no_match__';
  const t = `%${safe}%`;
  return `title.ilike.${t},make.ilike.${t},model.ilike.${t},city.ilike.${t},location.ilike.${t}`;
}

export const listListingsTool: ToolDef<ListingFilters, ListingSummary[]> = {
  name: 'list_listings',
  description:
    "Search AutoHire's listings with the same filters the browse page uses. Call this before booking, " +
    'messaging, or watchlisting a car you only know by description — resolve it to a real listing id first.',
  input_schema: {
    type: 'object',
    properties: {
      country: { type: 'string', description: "ISO 3166-1 alpha-2 market, e.g. 'RW'." },
      city: { type: 'string' },
      category: { type: 'string', enum: CATEGORIES },
      ownerType: { type: 'string', enum: ['individual', 'business'] },
      transmission: { type: 'string', enum: ['automatic', 'manual'] },
      fuel: { type: 'string', enum: ['petrol', 'diesel', 'electric', 'hybrid'] },
      minSeats: { type: 'integer' },
      maxPriceRwf: { type: 'integer' },
      query: { type: 'string', description: 'Free-text: make, model, or keywords.' },
    },
  },
  scope: 'any',
  effect: 'read',
  summary: (input) => `Searching listings${input.query ? ` for "${input.query}"` : ''}${input.city ? ` in ${input.city}` : ''}`,
  async run(ctx, input) {
    let q = ctx.supabase.from('listings').select('*');
    if (input.country) q = q.eq('country', input.country);
    if (input.city) q = q.eq('city', input.city);
    if (input.category) q = q.eq('category', input.category);
    if (input.ownerType) q = q.eq('owner_type', input.ownerType);
    if (input.transmission) q = q.eq('transmission', input.transmission);
    if (input.fuel) q = q.eq('fuel', input.fuel);
    if (input.minSeats) q = q.gte('seats', input.minSeats);
    if (input.maxPriceRwf) q = q.lte('price_per_day_rwf', input.maxPriceRwf);
    for (const word of keywordsOf(input.query)) q = q.or(keywordConditions(word));
    const ordered = q.order('rating_avg', { ascending: false }).order('id', { ascending: true }).limit(20);
    return mapRows<ListingSummary>(await run(ordered));
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
