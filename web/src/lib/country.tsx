import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { client } from '@/lib/client';
import type { PayoutCountry } from '@/lib/payments';

export interface Country {
  /** ISO 3166-1 alpha-2 code. Also the value stored on `Listing.country`. */
  code: string;
  name: string;
  /** Emoji flag for the selector. */
  flag: string;
  /**
   * Local currency listings in this country are priced + charged in. Sourced
   * from PayHold, so this is any ISO code PayHold serves, not a fixed set.
   */
  currency: string;
}

/**
 * Markets AutoHire serves — sourced from PayHold's `payment-options`, not a
 * hardcoded constant.
 *
 * Selecting a country filters the catalogue to cars in that country and
 * switches the *display* currency (prices convert via live FX). Rwanda is the
 * default (the home market).
 *
 * The hardcoded four below are only a fallback for when PayHold is unreachable
 * or not yet configured — the live list replaces them on load. Keeping a short
 * fallback means the app never has an empty selector.
 */
const FALLBACK_COUNTRIES: Country[] = [
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', currency: 'RWF' },
  { code: 'AE', name: 'UAE (Dubai)', flag: '🇦🇪', currency: 'AED' },
  { code: 'CN', name: 'China', flag: '🇨🇳', currency: 'CNY' },
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
];

const DEFAULT_CODE = 'RW';
const STORAGE_KEY = 'autohire.country';

/** A country is "available" if PayHold can move money there in either direction and it is not sanctioned. */
function isAvailable(c: PayoutCountry): boolean {
  return !c.restricted && (c.can_collect || c.can_payout);
}

/** Turn PayHold's routing table into the selector's country list. */
function toCountries(opts: PayoutCountry[]): Country[] {
  const list = opts.filter(isAvailable).map((c) => ({
    code: c.code,
    name: c.name,
    flag: c.flag,
    currency: c.currency,
  }));
  // Guarantee the default exists even if PayHold's table omits it.
  if (!list.some((c) => c.code === DEFAULT_CODE)) list.unshift(FALLBACK_COUNTRIES[0]);
  return list;
}

function loadInitial(countries: Country[]): Country {
  const fallback = countries.find((c) => c.code === DEFAULT_CODE) ?? countries[0];
  if (typeof window === 'undefined') return fallback;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return countries.find((c) => c.code === saved) ?? fallback;
}

interface CountryValue {
  country: Country;
  setCountry: (code: string) => void;
  countries: Country[];
}

const CountryContext = createContext<CountryValue | null>(null);

export function CountryProvider({ children }: { children: ReactNode }) {
  const [countries, setCountries] = useState<Country[]>(FALLBACK_COUNTRIES);
  const [country, setCountryState] = useState<Country>(() => loadInitialReference());

  // Resolve the initial selection once we know the fallback list. Defined as a
  // function so the effect below can re-resolve against the live list.
  function loadInitialReference(): Country {
    return loadInitial(FALLBACK_COUNTRIES);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const opts = await client.payholdPayoutCountries();
        if (!active) return;
        const next = toCountries(opts);
        if (next.length) {
          setCountries(next);
          // Re-resolve the saved choice against the live list; if the saved
          // country is no longer listed, fall back to the default.
          setCountryState(loadInitial(next));
        }
      } catch {
        // Keep the fallback list — better a short list than none, and the
        // payout screen falls back to its own hardcoded rules otherwise.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setCountry = useCallback(
    (code: string) => {
      const next = countries.find((c) => c.code === code);
      if (!next) return;
      setCountryState(next);
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next.code);
    },
    [countries],
  );

  const value = useMemo<CountryValue>(
    () => ({ country, setCountry, countries }),
    [country, setCountry, countries],
  );

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

export function useCountry() {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error('useCountry must be used within a CountryProvider');
  return ctx;
}
