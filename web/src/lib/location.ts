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
