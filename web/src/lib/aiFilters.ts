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
 * so it's there the instant `/ai` mounts rather than a moment later.
 *
 * A key present in `patch` with the value `undefined` is a *clear*, and the
 * `delete` below is what says so out loud. It changes nothing today: the
 * spread already overwrites the stored value with `undefined`, and
 * `JSON.stringify` omits undefined properties, so the key was dropped either
 * way — verified, not assumed. It is written explicitly because the clear
 * matters and was previously an accident of the serializer: Home hands over
 * `{ city: undefined }` whenever a real coordinate resolves (a picked
 * suggestion or a GPS fix — see its `onPointMatch`), and `city` is a hard
 * `.eq()`, so a `city` that survived here would beat the exact location the
 * renter had just given. Swap `sessionStorage` for anything that keeps
 * undefined keys and the incidental version breaks silently; this one
 * doesn't.
 */
export function mergeAiFilters(patch: ListingFilters): void {
  try {
    const next: ListingFilters = { ...loadAiFilters(), ...patch };
    for (const key of Object.keys(patch) as (keyof ListingFilters)[]) {
      if (patch[key] === undefined) delete next[key];
    }
    sessionStorage.setItem(AI_FILTERS_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota — the navigation still works, just without the carry-over.
  }
}
