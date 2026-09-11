import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useCountry } from '@/lib/country';
import { saveHomeLocation } from '@/lib/homeLocation';
import { useMyLocation } from '@/lib/useMyLocation';
import { toast, Notice, Button } from '@/components/ui';

const DISMISS_KEY = 'autohire.locationPrompted';

/**
 * Slim, dismissible banner that asks for the visitor's location so we can show
 * cars and prices for their country ("tell them you need this"). Purely additive:
 * declining just leaves the manual header country selector in charge. Shows once
 * (choice persists in localStorage). Uses the browser Geolocation API + a free,
 * keyless reverse-geocode to map coordinates → country.
 *
 * The coordinate itself is kept, not just the country it resolves to. The copy
 * below says "cars near you", and until this saved it, the banner delivered a
 * market and a currency — a whole country is not "near you". `saveHomeLocation`
 * is what Home's grid seeds `nearLat`/`nearLng` from, so accepting here is what
 * turns "Recommended" into cars actually ranked by distance from the renter,
 * for this visit and every one after it.
 */
export function LocationPrompt() {
  const { country, setCountry, countries, setCurrency } = useCountry();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const asked = window.localStorage.getItem(DISMISS_KEY);
    if (!asked && 'geolocation' in navigator) setShow(true);
  }, []);

  function done() {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  }

  // The shared hook, not a bare getCurrentPosition: it falls back to an
  // approximate network location when the browser's own provider can't
  // produce a fix (some Firefox builds fail every time), and it never leaves
  // "Detecting…" spinning when Firefox drops the permission prompt silently.
  const { locate } = useMyLocation();

  function detect() {
    setBusy(true);
    locate(
      async ({ lat: latitude, lng: longitude }) => {
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
          );
          const data = await res.json();
          const code = String(data.countryCode ?? '').toUpperCase();
          const match = countries.find((c) => c.code === code);

          // Saved before the market check below, and regardless of how that
          // goes: the renter's coordinate is true whether or not we happen to
          // operate where they're standing, and it costs nothing to already
          // have it the day we do. The label is whatever this lookup resolved
          // — never a name inferred from a coordinate table.
          const label = [data.locality, data.city, data.principalSubdivision, data.countryName]
            .map((part: unknown) => String(part ?? '').trim())
            .filter((part, i, all) => part && all.indexOf(part) === i)
            .slice(0, 2)
            .join(', ');
          saveHomeLocation({
            lat: latitude,
            lng: longitude,
            label: label || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          });

          if (match) {
            setCountry(match.code);
            // Geolocation is as strong a signal of "their currency" as it gets —
            // matches the promise in the banner's own copy above.
            setCurrency(match.currency);
            toast.success(`Showing cars near you in ${match.name}, prices in ${match.currency}.`);
          } else {
            toast.info(
              `We don't operate in ${data.countryName ?? 'your area'} yet — pick a country to browse.`,
            );
          }
        } catch {
          toast.error("Couldn't detect your location — pick your country instead.");
        } finally {
          setBusy(false);
          done();
        }
      },
      (reason) => {
        setBusy(false);
        if (reason === 'denied') {
          toast.info('No problem — pick your country from the top-right selector any time.');
        } else {
          toast.error("Couldn't detect your location — pick your country instead.");
        }
        done();
      },
    );
  }

  if (!show) return null;

  return (
    // Info tone (Notice), not a green-tinted bar — this is a prompt/
    // opportunity, not the page's action, so "Use my location" is an
    // `outline` button rather than the accent. Edge-to-edge and squared off
    // (no card radius) since this sits as a full-width strip under the
    // header, not a floating card.
    //
    // Stacked on mobile: at 390px a row squeezed the copy into a ~110px
    // column that wrapped to seven lines. Below `sm:` it's text, then the
    // button full-width, then the dismiss X on its own trailing row.
    <div className="border-b border-[var(--color-line)]">
      <div className="mx-auto max-w-[1500px] px-4 py-2.5">
        <Notice
          tone="info"
          className="items-start rounded-none p-0 sm:items-center"
        >
          <MapPin size={16} className="mt-0.5 shrink-0 text-[var(--color-info-500)] sm:mt-0" />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="flex-1 text-[var(--color-content-muted)]">
              Share your location so we show cars near you with prices in your currency. You're
              browsing <span className="font-medium text-[var(--color-content)]">{country.name}</span> now.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={detect}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              {busy ? 'Detecting…' : 'Use my location'}
            </Button>
          </div>
          <button
            type="button"
            onClick={done}
            aria-label="Dismiss"
            className="shrink-0 self-start rounded-[var(--radius-pill)] p-1.5 text-[var(--color-content-subtle)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)] sm:self-center"
          >
            <X size={16} />
          </button>
        </Notice>
      </div>
    </div>
  );
}
