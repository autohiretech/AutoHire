import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useCountry } from '@/lib/country';
import { saveHomeLocation } from '@/lib/homeLocation';
import { useMyLocation } from '@/lib/useMyLocation';
import { useT } from '@/lib/i18n';
import { toast } from '@/components/ui';

const DISMISS_KEY = 'autohire.locationPrompted';

/**
 * One dismissible line under the header that offers to locate the visitor so
 * we can show cars near them, in their market and their currency ("tell them
 * you need this"). Purely additive: declining just leaves the manual header
 * country selector in charge. Shows once (choice persists in localStorage).
 * Uses the browser Geolocation API + a free, keyless reverse-geocode to map
 * coordinates → country.
 *
 * **Why a line and not a card.** This used to be a `Notice` card — icon, two
 * sentences, a full-width button, a dismiss row — and on a 390px phone it
 * stood ~150px tall *above the hero*. Measured on the live site: with it, the
 * eco banner, the header and the hero, the first car started at y≈693 of an
 * 844px viewport, i.e. a first-time visitor scrolled past two interruptions
 * before seeing what the site sells. The hero's own "Where" field already
 * carries a "use my current location" button (SearchBar) for the renter who
 * wants to search from where they stand; what this strip uniquely adds is the
 * market + currency switch below, and that offer fits in one line. So: one
 * line, ~34px, caption type, the action as a text button — the shape of the
 * eco banner directly above it rather than a second hero. Every string is
 * from the dictionary, because this is the first thing a Kinyarwanda reader
 * sees under the header and it used to be the first thing that wasn't in
 * their language.
 *
 * The coordinate itself is kept, not just the country it resolves to. The copy
 * says "cars near you", and until this saved it, the banner delivered a
 * market and a currency — a whole country is not "near you". `saveHomeLocation`
 * is what Home's grid seeds `nearLat`/`nearLng` from, so accepting here is what
 * turns "Recommended" into cars actually ranked by distance from the renter,
 * for this visit and every one after it.
 */
export function LocationPrompt() {
  const { setCountry, countries, setCurrency } = useCountry();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();

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
            // matches the promise in the strip's own copy above.
            setCurrency(match.currency);
            toast.success(
              t('location.showingNear', { country: match.name, currency: match.currency }),
            );
          } else {
            toast.info(
              t('location.notOperating', {
                place: data.countryName ? String(data.countryName) : t('location.yourArea'),
              }),
            );
          }
        } catch {
          toast.error(t('location.detectFailed'));
        } finally {
          setBusy(false);
          done();
        }
      },
      (reason) => {
        setBusy(false);
        if (reason === 'denied') {
          toast.info(t('location.denied'));
        } else {
          toast.error(t('location.detectFailed'));
        }
        done();
      },
    );
  }

  if (!show) return null;

  return (
    // Same surface and type as the eco banner above it (sunken ground, caption
    // text), so the two read as one quiet band of standing facts under the
    // header rather than a banner and then a card. The action is a text
    // button in the accent — the accent is spent on it because it is the
    // only thing on this line that does anything — and the copy is a single
    // short clause that stays on one line at 320px; anything longer truncates
    // rather than wrapping, since a second line is exactly what this replaced.
    <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)]">
      <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-1.5">
        <MapPin size={14} className="shrink-0 text-[var(--color-info-500)]" />
        <p className="min-w-0 flex-1 truncate text-caption text-[var(--color-content-muted)]">
          {t('location.nearYou')}
        </p>
        <button
          type="button"
          onClick={detect}
          disabled={busy}
          className="shrink-0 whitespace-nowrap text-caption font-semibold text-[var(--color-accent-on)] hover:underline disabled:opacity-60"
        >
          {busy ? t('location.detecting') : t('location.useMyLocation')}
        </button>
        <button
          type="button"
          onClick={done}
          aria-label={t('search.dismiss')}
          className="shrink-0 rounded-[var(--radius-pill)] p-1 text-[var(--color-content-subtle)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-content)]"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
