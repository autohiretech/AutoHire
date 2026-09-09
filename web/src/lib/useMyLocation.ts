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
 * This hook is the GPS fix and nothing else — the caller gets a raw
 * `{lat, lng}` back and decides how to label it. Both callers show the plain
 * `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})` string right away
 * and then swap in a real place name from `reverseGeocode` (`@/lib/geocoding`)
 * once that second round trip lands, so the label is never what the renter is
 * left reading.
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
