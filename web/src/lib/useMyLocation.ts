import { useState } from 'react';

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Wraps a single on-demand `navigator.geolocation.getCurrentPosition` call —
 * the "use my current location" affordance shared by /search's pickup bar
 * and the compound `SearchBar` (Home hero + /ai). Pulled out of
 * `SearchResultsPage`'s original inline `useCurrentLocation` so both share
 * one implementation instead of drifting.
 *
 * There is no reverse-geocoding in this codebase — the caller only ever gets
 * a raw `{lat, lng}` back and is responsible for however it wants to label
 * that (the existing UX everywhere is a plain
 * `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})` string).
 */
export function useMyLocation() {
  const [locating, setLocating] = useState(false);

  function locate(onResult: (point: Coordinates) => void, onError?: () => void) {
    if (!navigator.geolocation) {
      onError?.();
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onResult({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        onError?.();
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return { locating, locate };
}
