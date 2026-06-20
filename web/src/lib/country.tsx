import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Country {
  /** ISO 3166-1 alpha-2 code. */
  code: string;
  name: string;
  /** Emoji flag for the selector. */
  flag: string;
  /** ISO 4217 currency, kept for when listings become multi-currency. */
  currency: string;
}

/** Markets AutoHire serves. Rwanda is the default; renters pick their country. */
export const COUNTRIES: Country[] = [
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', currency: 'RWF' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES' },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬', currency: 'UGX' },
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿', currency: 'TZS' },
  { code: 'BI', name: 'Burundi', flag: '🇧🇮', currency: 'BIF' },
  { code: 'CD', name: 'DR Congo', flag: '🇨🇩', currency: 'CDF' },
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
