import type { ListingFilters } from '@/lib/types';

/**
 * The one place `/ai`'s persisted filter state lives, so a page that sets a
 * filter *before* navigating to `/ai` (the Home hero's SearchBar, picking a
 * city or dates and then hitting search) and `/ai` itself (which loads this
 * on mount) are reading and writing the same key rather than two copies that
 * can drift. Without this, picking "Kigali, Sep 12–14" on Home and hitting
 * search would silently lose both the moment `/ai` mounted with its own
 * empty state.
 */
export const AI_FILTERS_KEY = 'autohire-ai-filters';

export function loadAiFilters(): ListingFilters {
  try {
    const raw = sessionStorage.getItem(AI_FILTERS_KEY);
    return raw ? (JSON.parse(raw) as ListingFilters) : {};
  } catch {
    return {};
  }
}

/** Merges `patch` into whatever `/ai` already has stored — called right
 * before navigating there with a filter the renter already picked elsewhere,
 * so it's there the instant `/ai` mounts rather than a moment later. */
export function mergeAiFilters(patch: ListingFilters): void {
  try {
    sessionStorage.setItem(AI_FILTERS_KEY, JSON.stringify({ ...loadAiFilters(), ...patch }));
  } catch {
    // Private mode / quota — the navigation still works, just without the carry-over.
  }
}
