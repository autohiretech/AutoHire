import type { CarCategory } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import type { Listing } from '@autohire/shared';
import { formatRwf } from '@/lib/format';

/**
 * Demo "AI" for AI Mode — a local stand-in for the ai-search Edge Function so
 * the experience works without API credits. It reads the natural-language
 * request with simple keyword heuristics to build ListingFilters, then writes a
 * human-sounding summary from the *real* listings those filters return. No
 * network / model calls: everything here is deterministic string matching.
 */

const CITIES = ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'];

const CATEGORY_WORDS: { match: RegExp; value: CarCategory }[] = [
  { match: /\bsuv\b/i, value: 'suv' },
  { match: /\b(4x4|4wd|off[-\s]?road|land ?cruiser|prado)\b/i, value: '4x4' },
  { match: /\b(sedan|saloon|corolla)\b/i, value: 'sedan' },
  { match: /\b(hatchback|hatch)\b/i, value: 'hatchback' },
  { match: /\b(pickup|pick[-\s]?up|truck)\b/i, value: 'pickup' },
  { match: /\b(minibus|coaster)\b/i, value: 'minibus' },
  { match: /\b(van|caravan)\b/i, value: 'van' },
  { match: /\b(luxury|premium|range rover|prestige|vip)\b/i, value: 'luxury' },
];

/** Turn a natural-language request into listing filters (best-effort). */
export function interpretQuery(query: string): ListingFilters {
  const q = query.toLowerCase();
  const filters: ListingFilters = {};

  const cat = CATEGORY_WORDS.find((c) => c.match.test(q));
  if (cat) filters.category = cat.value;

  if (/\bautomatic|\bauto\b/.test(q)) filters.transmission = 'automatic';
  else if (/\bmanual\b/.test(q)) filters.transmission = 'manual';

  if (/\b(company|business|agency|fleet)\b/.test(q)) filters.ownerType = 'business';
  else if (/\b(individual|private|person)\b/.test(q)) filters.ownerType = 'individual';

  const city = CITIES.find((c) => q.includes(c.toLowerCase()));
  if (city) filters.city = city;

  // Seats: "7 people", "5 seats", "family" (5+), "group" (7+).
  const seatMatch = q.match(/(\d+)\s*(?:people|persons?|seats?|passengers?|pax)/);
  if (seatMatch) filters.minSeats = Number(seatMatch[1]);
  else if (/\bfamily\b/.test(q)) filters.minSeats = 5;
  else if (/\bgroup\b/.test(q)) filters.minSeats = 7;

  // Price: "under 50000", "below 40k", "cheap/budget/affordable".
  const priceMatch = q.match(/(?:under|below|less than|max|up to)\s*(?:rwf|rf)?\s*([\d,]+)\s*(k)?/);
  if (priceMatch) {
    let n = Number(priceMatch[1].replace(/,/g, ''));
    if (priceMatch[2]) n *= 1000;
    if (n > 0) filters.maxPriceRwf = n;
  } else if (/\b(cheap|cheapest|budget|affordable|low[-\s]?cost)\b/.test(q)) {
    filters.maxPriceRwf = 40000;
  }

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
  const prices = listings.map((l) => l.pricePerDayRwf);
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
