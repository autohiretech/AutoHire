import type { CarCategory } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import type { Listing } from '@autohire/shared';
import { formatRwf } from '@/lib/format';
import { ALL_CITIES } from '@/lib/cities';
import { listingHeadlinePrice } from '@/lib/pricing';

/**
 * Demo "AI" for AI Mode — a local stand-in for the ai-search Edge Function so
 * the experience works without API credits. It reads the natural-language
 * request with simple keyword heuristics to build ListingFilters, then writes a
 * human-sounding summary from the *real* listings those filters return. No
 * network / model calls: everything here is deterministic string matching.
 */

/**
 * Machinery is matched before vehicles: "forklift truck" is a forklift, not a pickup,
 * and the pickup rule claims the bare word "truck".
 */
const CATEGORY_WORDS: { match: RegExp; value: CarCategory }[] = [
  // Cultivating + building machinery
  { match: /\b(tractor)\b/i, value: 'tractor' },
  { match: /\b(harvester|combine)\b/i, value: 'harvester' },
  { match: /\b(tiller|cultivator|rotavator)\b/i, value: 'tiller' },
  { match: /\b(excavator|digger|backhoe)\b/i, value: 'excavator' },
  { match: /\b(bulldozer|dozer)\b/i, value: 'bulldozer' },
  { match: /\b(wheel[-\s]?loader|loader)\b/i, value: 'loader' },
  { match: /\b(crane)\b/i, value: 'crane' },
  { match: /\b(forklift|fork[-\s]?lift)\b/i, value: 'forklift' },
  // Road vehicles
  { match: /\bsuv\b/i, value: 'suv' },
  { match: /\b(4x4|4wd|off[-\s]?road|land ?cruiser|prado)\b/i, value: '4x4' },
  { match: /\b(sedan|saloon|corolla)\b/i, value: 'sedan' },
  { match: /\b(hatchback|hatch)\b/i, value: 'hatchback' },
  { match: /\b(pickup|pick[-\s]?up|truck)\b/i, value: 'pickup' },
  { match: /\b(minibus|coaster)\b/i, value: 'minibus' },
  { match: /\b(van|caravan)\b/i, value: 'van' },
  { match: /\b(luxury|premium|range rover|prestige|vip)\b/i, value: 'luxury' },
];

/** Longest first so a two-word city ("New York") wins over any shorter substring. */
const CITY_MATCHES = [...ALL_CITIES].sort((a, b) => b.length - a.length);

/**
 * Connective words that carry no search meaning on their own ("a car for 5
 * people in Kigali" → once "5 people" and "Kigali" are pulled out as filters,
 * these are what's left over). Stripped so they never pollute the keyword
 * search that catches makes/models/titles the structured filters don't.
 */
const FILLER_WORDS_RE =
  /\b(a|an|the|i|me|my|we|us|need|needs|needed|want|wants|wanted|looking|look|for|with|without|in|at|near|around|please|some|any|to|is|are|of|and|or|car|cars|vehicle|vehicles|rent|renting|rental|hire|hiring|book|booking)\b/gi;

/**
 * A geocoded address rather than free text. Every label that reaches the
 * pickup box from outside the renter's own typing is a Nominatim
 * `display_name` — "Gasabo District, City of Kigali, Rwanda" from "use my
 * current location", or the same shape from the suggestions dropdown — and
 * those are always comma-separated. A renter typing into "Where do you want
 * to pick up?" does not use commas, so the comma is the honest signal here;
 * no attempt is made to recognize the world's administrative vocabulary
 * ("district", "province", "governorate", …), which would be a list that is
 * wrong in some market on the day it's written.
 */
function looksLikeAddress(query: string): boolean {
  return query.includes(',');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turn a natural-language request into listing filters (best-effort). Any
 * words consumed by a recognized filter (a category, "automatic", a city
 * name, ...) are stripped from a working copy of the query; whatever's left —
 * typically a make/model or other free text — comes back as `filters.query`
 * so it still narrows results via keyword search instead of being silently
 * dropped once *any* structured filter is recognized.
 */
export function interpretQuery(
  query: string,
  opts: { resolvedPlace?: boolean } = {},
): ListingFilters {
  const q = query.toLowerCase();
  const filters: ListingFilters = {};
  let remaining = q;

  const cat = CATEGORY_WORDS.find((c) => c.match.test(q));
  if (cat) {
    filters.category = cat.value;
    remaining = remaining.replace(cat.match, ' ');
  }

  if (/\bautomatic\b|\bauto\b/.test(q)) {
    filters.transmission = 'automatic';
    remaining = remaining.replace(/\bautomatic\b|\bauto\b/g, ' ');
  } else if (/\bmanual\b/.test(q)) {
    filters.transmission = 'manual';
    remaining = remaining.replace(/\bmanual\b/g, ' ');
  }

  if (/\b(company|business|agency|fleet)\b/.test(q)) {
    filters.ownerType = 'business';
    remaining = remaining.replace(/\b(company|business|agency|fleet)\b/g, ' ');
  } else if (/\b(individual|private|person)\b/.test(q)) {
    filters.ownerType = 'individual';
    remaining = remaining.replace(/\b(individual|private|person)\b/g, ' ');
  }

  const city = CITY_MATCHES.find((c) => q.includes(c.toLowerCase()));
  if (city) {
    filters.city = city;
    remaining = remaining.replace(new RegExp(escapeRegExp(city.toLowerCase()), 'g'), ' ');
  }

  // Seats: "7 people", "5 seats", "family" (5+), "group" (7+).
  const seatMatch = q.match(/(\d+)\s*(?:people|persons?|seats?|passengers?|pax)/);
  if (seatMatch) {
    filters.minSeats = Number(seatMatch[1]);
    remaining = remaining.replace(seatMatch[0], ' ');
  } else if (/\bfamily\b/.test(q)) {
    filters.minSeats = 5;
    remaining = remaining.replace(/\bfamily\b/g, ' ');
  } else if (/\bgroup\b/.test(q)) {
    filters.minSeats = 7;
    remaining = remaining.replace(/\bgroup\b/g, ' ');
  }

  // Price: "under 50000", "below 40k", "cheap/budget/affordable".
  const priceMatch = q.match(/(?:under|below|less than|max|up to)\s*(?:rwf|rf)?\s*([\d,]+)\s*(k)?/);
  if (priceMatch) {
    let n = Number(priceMatch[1].replace(/,/g, ''));
    if (priceMatch[2]) n *= 1000;
    if (n > 0) filters.maxPriceRwf = n;
    remaining = remaining.replace(priceMatch[0], ' ');
  } else if (/\b(cheap|cheapest|budget|affordable|low[-\s]?cost)\b/.test(q)) {
    filters.maxPriceRwf = 40000;
    remaining = remaining.replace(/\b(cheap|cheapest|budget|affordable|low[-\s]?cost)\b/g, ' ');
  }

  remaining = remaining.replace(FILLER_WORDS_RE, ' ').replace(/\s+/g, ' ').trim();
  // An address is *all* place. Once the city is out of it what's left is
  // administrative context — "gasabo district", "rwanda" — never a make or a
  // model, and `filters.query` is an AND of keywords where every word has to
  // hit title/make/model/city/location. Feeding an address into it is why
  // searching from where you're standing returned "No cars match" in a city
  // holding 68 of them: "gasabo" alone matched one listing, and the stray ","
  // token matched nothing at all, so the AND could only ever be empty.
  //
  // There are two ways to know the box holds a place. `resolvedPlace` is the
  // exact one — the caller had a coordinate that arrived *with* this text, so
  // the text is a geocoded label by construction, not by resemblance. The
  // comma is the fallback for when no coordinate came along, and on its own it
  // was too greedy: it also swallowed "toyota, automatic", which is a comma
  // and a car, and quietly returned every automatic in the country. Requiring
  // a city we recognise alongside it is what separates "Gasabo District, City
  // of Kigali, Rwanda" from "toyota, automatic" without inventing a
  // dictionary of administrative words that is wrong in some market on the
  // day it is written.
  //
  // "toyota, kigali" is the case still caught by the fallback, and it fails
  // toward the city rather than toward nothing — every Kigali car instead of
  // zero. That is the right direction to be wrong in, and a coordinate makes
  // it moot, since `resolvedPlace` then answers the question exactly.
  const isPlace = opts.resolvedPlace || (looksLikeAddress(query) && !!filters.city);
  // A remainder with no letter or digit in it — the lone "," left by "prado,
  // 7 seats" once both halves are understood — is not a keyword and must not
  // travel as one. Both keyword implementations drop such a token, but the
  // SQL one only does so as of migration 076, and until that is applied the
  // live RPC still turns it into a match-nothing sentinel and returns zero
  // rows. Not emitting it is what makes this correct on today's database as
  // well as tomorrow's, rather than correct only once a migration lands.
  if (remaining && !isPlace && /[\p{L}\p{N}]/u.test(remaining)) filters.query = remaining;

  return filters;
}

/** A short, readable "reasoning" line for the collapsible thought process. */
export function describeThought(query: string, filters: ListingFilters): string {
  const parts: string[] = [];
  if (filters.category) parts.push(`category = ${filters.category}`);
  if (filters.transmission) parts.push(`transmission = ${filters.transmission}`);
  if (filters.minSeats) parts.push(`seats ≥ ${filters.minSeats}`);
  if (filters.maxPriceRwf) parts.push(`price ≤ ${formatRwf(filters.maxPriceRwf)}/day`);
  if (filters.ownerType) parts.push(`host = ${filters.ownerType}`);
  if (filters.city) parts.push(`city = ${filters.city}`);
  const derived = parts.length ? parts.join(', ') : 'no hard constraints — matching on keywords';
  return `Understanding “${query.trim()}” → ${derived}. Searching AutoHire's verified listings and ranking by rating and price.`;
}

/** A human-sounding summary built from the real matching listings. */
export function buildSummary(query: string, listings: Listing[]): string {
  if (!listings.length) {
    return `I couldn't find any cars matching “${query.trim()}” right now. Try widening the request — a different category, city, or a higher daily budget.`;
  }
  const prices = listings.map((l) => listingHeadlinePrice(l).amount);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cats = Array.from(new Set(listings.map((l) => l.category)));
  const cities = Array.from(new Set(listings.map((l) => l.city)));
  const business = listings.filter((l) => l.ownerType === 'business').length;
  const individual = listings.length - business;

  const priceLine =
    min === max
      ? `at ${formatRwf(min)} per day`
      : `from ${formatRwf(min)} to ${formatRwf(max)} per day`;
  const hostLine =
    business && individual
      ? `${business} agency and ${individual} individual host${individual === 1 ? '' : 's'}`
      : business
        ? `${business} verified agenc${business === 1 ? 'y' : 'ies'}`
        : `${individual} individual host${individual === 1 ? '' : 's'}`;

  return (
    `I found ${listings.length} car${listings.length === 1 ? '' : 's'} matching your request, priced ${priceLine}. ` +
    `They include ${cats.join(', ')} options from ${hostLine}, mostly around ${cities.slice(0, 3).join(', ')}. ` +
    `Full specs, pricing and host profiles are below — ask a follow-up to refine.`
  );
}
