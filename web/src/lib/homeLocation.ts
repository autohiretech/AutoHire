/**
 * A renter's saved home location — set once in Account settings, read
 * wherever "around me" needs a coordinate without asking for a fresh GPS fix
 * on every visit (Home's "Recommended" grid defaulting to distance-sort,
 * primarily). Same persistence pattern `lib/country.tsx` and `lib/aiFilters.ts`
 * already use: localStorage, this device only — there is no `lat`/`lng`
 * column on `profiles` to sync it across devices, and adding one is a
 * migration, not a client change; noted here rather than silently pretended.
 *
 * The value itself is always a *resolved* coordinate — either a real GPS fix
 * or a real geocoded address (`reverseGeocode`/`useAddressSuggestions`,
 * Nominatim) — never a hardcoded city-coordinate table. "No hardcoded
 * coordinates, use the actual geocoding this app already has" is a
 * constraint on how a coordinate gets HERE, not just on the button that
 * first fetches one.
 */
export interface HomeLocation {
  lat: number;
  lng: number;
  /** Human label for display — "Kigali, Rwanda" from a resolved address, or
   * the city name picked from a suggestion. */
  label: string;
}

const KEY = 'autohire.home-location';

/**
 * Fired on this tab whenever the saved location changes, so a page already on
 * screen picks it up without a reload. The browser's own `storage` event is
 * not a substitute: it fires in *other* tabs, never the one that wrote. This
 * matters because both writers are things the renter does mid-visit — the
 * "Use my location" banner under the header, and Account → Your location —
 * and "find cars around me" that only takes effect on the *next* visit is not
 * what either of them appears to promise.
 */
const CHANGED = 'autohire:home-location';

/** Subscribe to saved-location changes. Returns its own unsubscribe, so a
 * caller can hand it straight back from `useEffect`. */
export function subscribeHomeLocation(
  onChange: (loc: HomeLocation | null) => void,
): () => void {
  const handler = () => onChange(loadHomeLocation());
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}

export function loadHomeLocation(): HomeLocation | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HomeLocation) : null;
  } catch {
    return null;
  }
}

export function saveHomeLocation(loc: HomeLocation): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loc));
  } catch {
    // Private mode / quota — the setting just doesn't persist past this tab.
  }
  // Announced even when the write above failed: the coordinate is still good
  // for this session, and a renter in a private window should still get cars
  // around them — they just won't get them again tomorrow.
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function clearHomeLocation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up if storage isn't available in the first place.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}
