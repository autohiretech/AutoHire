import type { Listing } from '@autohire/shared';

/**
 * The make+model of a listing, and whether a browse card has to say it.
 *
 * Hosts pick a model from the catalogue and a lot of those models carry a
 * designation rather than a name: `Corolla E120`, `3 Series E30`, `coupe SEC
 * W126`, `GMK3060`, `J1.6XN`. Those letters ARE the model to the people who
 * search by them — somebody after an E30 types "e30", not "3 Series" — and
 * `search_available_listings` matches them, because `listings.model` is in its
 * haystack (migration 093).
 *
 * What did not follow was the answer: the browse card shows the host's own
 * title and nothing else, and a title is free text — "Reliable car for Kigali
 * trips". So a search for "e30" returned the right car and then showed a card
 * with no E30 anywhere on it, which reads as a wrong result. The designation
 * existed in the database and in the listing form's picker, and was the one
 * place it never reached: the frontend.
 */

/** Punctuation and case are noise when comparing a model to a title: a host
 *  writing "Corolla-E120" has said the same thing as the catalogue's
 *  "Corolla E120". Mirrors `squash` in the listing form's picker. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Toyota Corolla E120" — the make and model as one readable name. */
export function vehicleName(listing: Pick<Listing, 'make' | 'model'>): string {
  return [listing.make?.trim(), listing.model?.trim()].filter(Boolean).join(' ');
}

/**
 * The make+model to print on a card, or `null` when the title already says it.
 *
 * Most hosts do title their listing "Toyota RAV4 — great for Kigali", and
 * repeating the same three words under it is noise on a card whose whole
 * design is about not carrying a line it doesn't need. So this only speaks up
 * when the title is missing the model — which is exactly the listing a
 * model-code search finds and cannot explain.
 */
export function hiddenVehicleName(
  listing: Pick<Listing, 'make' | 'model' | 'title'>,
): string | null {
  const model = listing.model?.trim();
  if (!model) return null;
  if (squash(listing.title ?? '').includes(squash(model))) return null;
  return vehicleName(listing);
}
