import { useRef, useState } from 'react';
import { locateByNetwork } from '@/lib/geocoding';

export interface Coordinates {
  lat: number;
  lng: number;
}

/** Where a fix came from. `device` is the browser's own geolocation; `network`
 * is the approximate, IP-based fallback — city-level at best, so callers say
 * so rather than presenting it as where the renter is standing. */
export type LocationSource = 'device' | 'network';

export interface LocatedPoint extends Coordinates {
  source: LocationSource;
}

/** `denied` — the renter (or their browser settings) said no, and we respect
 * it: no network fallback behind their back. `unavailable` — the browser
 * could not produce a fix *and* the network lookup failed too. */
export type LocateFailure = 'denied' | 'unavailable';

/** Firefox never calls either callback when the permission doorhanger is
 * dismissed by clicking elsewhere, and the spec's `timeout` only starts once
 * permission is granted — so without our own clock the button can spin
 * forever. Generous, because a renter may genuinely be reading the prompt. */
const WATCHDOG_MS = 20_000;

/**
 * Wraps a single on-demand `navigator.geolocation.getCurrentPosition` call —
 * the "use my current location" affordance shared by the compound `SearchBar`
 * (Home hero + /ai) and `ResearchField`'s "Closest to me".
 *
 * **Why the network fallback exists.** Browser geolocation is only as good as
 * the location provider the browser ships with. Firefox builds that still
 * point `geo.provider.network.url` at Mozilla Location Service — shut down in
 * 2024, and still the default in Debian/Kali's firefox-esr — fail every
 * request within a second with POSITION_UNAVAILABLE ("Unknown error acquiring
 * position"), while Chrome on the same machine works. So on `unavailable` or
 * `timeout` (never on `denied`) this asks `locateByNetwork` for an
 * IP-derived coordinate instead of giving up.
 *
 * The hook is the fix and nothing else — callers label it (via
 * `reverseGeocode`) and decide what to show for each failure.
 */
export function useMyLocation() {
  const [locating, setLocating] = useState(false);
  const runRef = useRef(0);

  function locate(
    onResult: (point: LocatedPoint) => void,
    onError?: (reason: LocateFailure) => void,
  ) {
    const run = ++runRef.current;
    let settled = false;
    setLocating(true);

    const finish = (fn: () => void) => {
      if (settled || run !== runRef.current) return;
      settled = true;
      clearTimeout(watchdog);
      setLocating(false);
      fn();
    };

    const fallBackToNetwork = async () => {
      if (settled) return;
      const point = await locateByNetwork();
      finish(() => (point ? onResult({ ...point, source: 'network' }) : onError?.('unavailable')));
    };

    const watchdog = setTimeout(() => void fallBackToNetwork(), WATCHDOG_MS);

    if (!navigator.geolocation) {
      void fallBackToNetwork();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        finish(() =>
          onResult({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device' }),
        ),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) finish(() => onError?.('denied'));
        else void fallBackToNetwork();
      },
      // A fix up to a minute old is still where the renter is, and reusing it
      // skips a cold GPS start on phones.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return { locating, locate };
}
