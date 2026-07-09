import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useCountry } from '@/lib/country';
import { toast } from '@/components/ui';

const DISMISS_KEY = 'autohire.locationPrompted';

/**
 * Slim, dismissible banner that asks for the visitor's location so we can show
 * cars and prices for their country ("tell them you need this"). Purely additive:
 * declining just leaves the manual header country selector in charge. Shows once
 * (choice persists in localStorage). Uses the browser Geolocation API + a free,
 * keyless reverse-geocode to map coordinates → country.
 */
export function LocationPrompt() {
  const { country, setCountry, countries } = useCountry();
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

  function detect() {
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
          );
          const data = await res.json();
          const code = String(data.countryCode ?? '').toUpperCase();
          const match = countries.find((c) => c.code === code);
          if (match) {
            setCountry(match.code);
            toast.success(`Showing cars in ${match.name}, prices in ${match.currency}.`);
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
      () => {
        setBusy(false);
        toast.info('No problem — pick your country from the top-right selector any time.');
        done();
      },
      { timeout: 8000 },
    );
  }

  if (!show) return null;

  return (
    <div className="border-b border-brand-100 bg-brand-50">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-2.5 text-sm">
        <MapPin size={16} className="shrink-0 text-brand-600" />
        <p className="flex-1 text-ink-700">
          Share your location so we show cars near you with prices in your currency. You're
          browsing <span className="font-medium text-ink-900">{country.name}</span> now.
        </p>
        <button
          type="button"
          onClick={detect}
          disabled={busy}
          className="shrink-0 rounded-full bg-brand-600 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-70"
        >
          {busy ? 'Detecting…' : 'Use my location'}
        </button>
        <button
          type="button"
          onClick={done}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1.5 text-ink-400 transition-colors hover:bg-brand-100 hover:text-ink-700"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
