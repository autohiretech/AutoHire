import { useEffect, useState } from 'react';

/** What kind of place a suggestion is, so the picker can show a meaningful
 * icon per row instead of the same pin eight times. Derived from Nominatim's
 * own `class`/`type`/`addresstype` fields — real data the API already
 * returns (verified against the live service: an airport comes back
 * `class=aeroway type=aerodrome`, a hotel `class=tourism type=hotel`, a city
 * `addresstype=city`), never a guess made from the display string. */
export type PlaceKind = 'airport' | 'hotel' | 'transit' | 'city' | 'place';

export interface AddressSuggestion {
  lat: number;
  lng: number;
  label: string;
  kind: PlaceKind;
}

const TRANSIT_TYPES = new Set(['station', 'halt', 'bus_station', 'bus_stop', 'terminal']);
const LODGING_TYPES = new Set(['hotel', 'motel', 'guest_house', 'hostel', 'apartment', 'chalet']);
const CITY_TYPES = new Set(['city', 'town', 'village', 'suburb', 'municipality', 'administrative']);

/** `place` is the honest fallback: it means "somewhere real that Nominatim
 * found", which is all we actually know when the class/type don't match a
 * category we have an icon for. */
function placeKindOf(cls?: string, type?: string, addressType?: string): PlaceKind {
  if (cls === 'aeroway' || type === 'aerodrome' || addressType === 'aeroway') return 'airport';
  if (cls === 'tourism' && type && LODGING_TYPES.has(type)) return 'hotel';
  if (cls === 'railway' || (type && TRANSIT_TYPES.has(type))) return 'transit';
  if ((addressType && CITY_TYPES.has(addressType)) || (cls === 'place' && type && CITY_TYPES.has(type))) {
    return 'city';
  }
  return 'place';
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
        const hits = (await res.json()) as {
          lat: string;
          lon: string;
          display_name: string;
          class?: string;
          type?: string;
          addresstype?: string;
        }[];
        setSuggestions(
          hits.map((h) => ({
            lat: Number(h.lat),
            lng: Number(h.lon),
            label: h.display_name,
            kind: placeKindOf(h.class, h.type, h.addresstype),
          })),
        );
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

/**
 * An approximate coordinate for the renter from their IP address, for when
 * the browser's own geolocation can't produce one (see `useMyLocation` — some
 * Firefox builds still ask a location service that no longer exists).
 * BigDataCloud's client endpoint, the same keyless service `LocationPrompt`
 * already calls: with no `latitude`/`longitude` it geolocates the caller's IP
 * (`lookupSource: "ip geolocation"`). City-level accuracy at best, and `null`
 * on any failure — never a default coordinate.
 */
export async function locateByNetwork(signal?: AbortSignal): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en', {
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { latitude?: number; longitude?: number };
    if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return null;
    if (data.latitude === 0 && data.longitude === 0) return null; // the service's "unknown"
    return { lat: data.latitude, lng: data.longitude };
  } catch {
    return null;
  }
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
