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
