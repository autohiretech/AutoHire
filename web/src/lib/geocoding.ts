import { useEffect, useState } from 'react';

export interface AddressSuggestion {
  lat: number;
  lng: number;
  label: string;
}

/** Live, debounced address suggestions from Nominatim (OpenStreetMap's free
 * geocoder) — shared by every "type an address, get a dropdown" input in the
 * app (the host's map picker, the search bar's pickup autocomplete) so they
 * don't each reimplement the same debounce/fetch/abort dance. Returns no
 * suggestions for anything under 3 characters — too short to mean anything,
 * and it'd just burn requests against Nominatim's shared free tier. */
export function useAddressSuggestions(query: string) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
          { headers: { 'Accept-Language': 'en' }, signal: controller.signal },
        );
        const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
        setSuggestions(hits.map((h) => ({ lat: Number(h.lat), lng: Number(h.lon), label: h.display_name })));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  return { suggestions, searching };
}

export interface ReverseGeocodeResult {
  /** A real, human place name for the coordinate — Nominatim's own
   * `display_name`, not a raw "(lat, lng)" string. */
  label: string;
  /** ISO 3166-1 alpha-2, uppercased to match this app's own country codes
   * (`RW`, `AE`, …) — Nominatim returns it lowercase. */
  countryCode?: string;
  /** The narrowest place name Nominatim offers, for matching against our
   * own known cities (`matchKnownCity`) — city, falling back to town/county/
   * state, since a GPS fix can land outside any city Nominatim recognizes as
   * one (a coordinate on the highway 20km from Kigali is still "near
   * Kigali" in `address.county`, even with no `address.city`). */
  place?: string;
}

/**
 * Turns a raw coordinate (from `navigator.geolocation`, typically) into an
 * actual place — algorithmic reverse geocoding against Nominatim, the same
 * free service `useAddressSuggestions` already calls for the forward
 * direction, not a hardcoded list of city coordinates and not a model call.
 * `null` on any failure (network, no result) — callers fall back to the raw
 * coordinate label rather than showing nothing.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' }, signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: {
        city?: string;
        town?: string;
        village?: string;
        county?: string;
        state?: string;
        country_code?: string;
      };
    };
    if (!data.display_name) return null;
    const a = data.address ?? {};
    return {
      label: data.display_name,
      countryCode: a.country_code?.toUpperCase(),
      place: a.city ?? a.town ?? a.village ?? a.county ?? a.state,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return null;
  }
}
