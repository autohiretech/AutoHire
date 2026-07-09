import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CurrencyCode } from '@/lib/currency';

export interface Country {
  /** ISO 3166-1 alpha-2 code. Also the value stored on `Listing.country`. */
  code: string;
  name: string;
  /** Emoji flag for the selector. */
  flag: string;
  /** Local currency listings in this country are priced + charged in. */
  currency: CurrencyCode;
}

/**
 * Markets AutoHire serves. Selecting a country filters the catalogue to cars in
 * that country and switches the *display* currency (prices convert via live FX).
 * Rwanda is the default (the home market). Currencies without a market of their
 * own (e.g. EUR) still live in `CURRENCIES` for conversion.
 */
export const COUNTRIES: Country[] = [
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', currency: 'RWF' },
  { code: 'AE', name: 'UAE (Dubai)', flag: '🇦🇪', currency: 'AED' },
  { code: 'CN', name: 'China', flag: '🇨🇳', currency: 'CNY' },
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
];

const DEFAULT_CODE = 'RW';
const STORAGE_KEY = 'autohire.country';

function loadInitial(): Country {
  const fallback = COUNTRIES.find((c) => c.code === DEFAULT_CODE) ?? COUNTRIES[0];
  if (typeof window === 'undefined') return fallback;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return COUNTRIES.find((c) => c.code === saved) ?? fallback;
}

interface CountryValue {
  country: Country;
  setCountry: (code: string) => void;
  countries: Country[];
}

const CountryContext = createContext<CountryValue | null>(null);

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<Country>(loadInitial);

  const setCountry = useCallback((code: string) => {
    const next = COUNTRIES.find((c) => c.code === code);
    if (!next) return;
    setCountryState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next.code);
  }, []);

  const value = useMemo<CountryValue>(
    () => ({ country, setCountry, countries: COUNTRIES }),
    [country, setCountry],
  );

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

export function useCountry() {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error('useCountry must be used within a CountryProvider');
  return ctx;
}
