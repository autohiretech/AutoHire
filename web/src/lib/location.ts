/** Ensure a user-entered URL has a scheme so it links out correctly. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Basic sanity check for a host-provided location link. */
export function isLikelyUrl(url: string): boolean {
  const t = url.trim();
  return t.length > 0 && /\.[a-z]{2,}/i.test(t) && !/\s/.test(t);
}

/** A Google Maps link to a pin, used as a fallback "Get directions". */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// The coordinate lives in different places depending on which Google Maps
// surface produced the link — a place page's URL, a plain search/query link,
// and the old `ll=` param all encode it differently. Long-form links carry
// one of these directly; short links (goo.gl/maps, maps.app.goo.gl) carry
// none of them — see isShortMapsLink / resolve-maps-link below.
const MAPS_COORD_PATTERNS = [
  /@(-?\d+\.\d+),(-?\d+\.\d+)/, // .../@-1.9441,30.0619,15z/...
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // a place page's embedded pin
  /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/, // ?q=-1.9441,30.0619
  /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/, // ?ll=-1.9441,30.0619 (older links)
];

/** Pulls a lat/lng straight out of a Google Maps URL, if it's encoded in the
 * URL itself — works for the long-form links Maps produces from a browser.
 * Returns null for anything else (a short link, a non-Maps link, a Maps
 * link that only names a place with no coordinate in the URL). */
export function extractLatLngFromMapsUrl(url: string): { lat: number; lng: number } | null {
  for (const pattern of MAPS_COORD_PATTERNS) {
    const m = url.match(pattern);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

/** Google's own share links (the "Share" button on mobile, mainly) come out
 * shortened — no coordinate anywhere in them, just an opaque path that only
 * resolves through a real HTTP redirect. Needs resolve-maps-link (a server
 * round trip — a browser's own fetch can't read a cross-origin redirect's
 * final URL) before extractLatLngFromMapsUrl has anything to work with. */
export function isShortMapsLink(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(goo\.gl\/maps|maps\.app\.goo\.gl)\//i.test(url.trim());
}

/** Any Google Maps link at all — long or short — as opposed to a What3Words
 * link or arbitrary arrival-instructions page, which this feature doesn't
 * touch. */
export function isGoogleMapsLink(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\b/i.test(url.trim()) || isShortMapsLink(url);
}
