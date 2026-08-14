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
import { useCurrentUser } from '@/lib/useCurrentUser';

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

/** Bare currency code shown in the picker when no country's home currency matches it. */
function genericCurrency(code: string): Country {
  return { code, name: code, flag: '💱', currency: code };
}

/**
 * A handful of currencies are shared by many sovereign countries (USD alone is
 * legal tender in the US, Ecuador, Panama, Timor-Leste, Zimbabwe, …). Picking
 * "whichever member PayHold happens to list first" reads as wrong — USD showed
 * up tagged Timor-Leste rather than the US just because of array order. These
 * are the currencies with a globally recognized reference country/area instead
 * of an arbitrary member state; anything else shared falls back to the bare
 * [[genericCurrency]] badge rather than guess.
 */
const CURRENCY_REFERENCE: Record<string, Country> = {
  USD: { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
  EUR: { code: 'EU', name: 'Euro area', flag: '🇪🇺', currency: 'EUR' },
  GBP: { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  XAF: { code: 'XAF', name: 'Central African CFA franc', flag: '🌍', currency: 'XAF' },
  XOF: { code: 'XOF', name: 'West African CFA franc', flag: '🌍', currency: 'XOF' },
};

interface CountryValue {
  /** The market being browsed — filters the catalogue. */
  country: Country;
  setCountry: (code: string) => void;
  countries: Country[];
  /**
   * The currency prices are DISPLAYED in — independent of `country`, so
   * browsing any market's cars shows prices in whatever currency the shopper
   * picked. A car is still charged in its own listing currency at checkout;
   * PayHold separately picks the renter's actual charge currency from their
   * account country (see payhold-create-deal), same as this defaults from.
   *
   * Never persisted — always resolved fresh from the renter's own account
   * country (or the browse market as a fallback) on every load, rather than
   * sticking to whatever was picked last session.
   */
  currency: string;
  setCurrency: (code: string) => void;
  /**
   * Every currency PayHold can actually collect, tenant-wide — from its
   * `payment-options` `currencies` field, not derived from `countries`. A
   * currency a rail can collect need not be any one country's home currency
   * (USD collects almost everywhere), so deriving one from the other
   * under-counts; this is the authority.
   */
  currencies: Country[];
}

const CountryContext = createContext<CountryValue | null>(null);

export function CountryProvider({ children }: { children: ReactNode }) {
  const [countries, setCountries] = useState<Country[]>(FALLBACK_COUNTRIES);
  const [country, setCountryState] = useState<Country>(() => loadInitialReference());
  const [currencyCodes, setCurrencyCodes] = useState<string[]>(FALLBACK_COUNTRIES.map((c) => c.currency));
  // In-memory only — never localStorage. An explicit pick lasts the tab, then
  // resolves fresh (account country → browse market) on the next load.
  const [currencyCode, setCurrencyCode] = useState<string | null>(null);
  const { data: me } = useCurrentUser();

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
        const next = toCountries(opts.countries);
        if (next.length) {
          setCountries(next);
          // Re-resolve the saved choice against the live list; if the saved
          // country is no longer listed, fall back to the default.
          setCountryState(loadInitial(next));
        }
        // Union with country-derived currencies as a defensive fallback —
        // `opts.currencies` should already be a superset, but a market's own
        // home currency should never go missing if that list is ever short.
        const union = new Set([...opts.currencies, ...next.map((c) => c.currency)]);
        if (union.size) setCurrencyCodes([...union]);
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

  const setCurrency = useCallback((code: string) => setCurrencyCode(code), []);

  // Every PayHold-collectible currency, in picker form — a matching country's
  // flag/name stands in where the pairing is unambiguous (this is genuinely the
  // currency that country accepts, and the only one that does), a curated
  // reference stands in for currencies several countries share, and anything
  // left just gets the bare code rather than an arbitrary/misleading country.
  const currencies = useMemo(() => {
    const byCurrency = new Map<string, Country[]>();
    for (const c of countries) {
      const list = byCurrency.get(c.currency);
      if (list) list.push(c);
      else byCurrency.set(c.currency, [c]);
    }
    return currencyCodes
      .map((code) => {
        const matches = byCurrency.get(code);
        if (matches?.length === 1) return matches[0];
        return CURRENCY_REFERENCE[code] ?? genericCurrency(code);
      })
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [countries, currencyCodes]);

  // Default the display currency to the renter's own account country — the
  // same field payhold-create-deal already reads to pick their real charge
  // currency — so browsing and checkout agree on "their" currency without the
  // shopper doing anything. Only a fallback: an explicit pick this session
  // always wins, and signed-out / no-account-country shoppers get the browse
  // market's currency instead.
  const profileCurrency = useMemo(() => {
    if (!me?.country) return undefined;
    return countries.find((c) => c.code === me.country)?.currency;
  }, [me?.country, countries]);
  const currency = currencyCode ?? profileCurrency ?? country.currency;

  const value = useMemo<CountryValue>(
    () => ({ country, setCountry, countries, currency, setCurrency, currencies }),
    [country, setCountry, countries, currency, setCurrency, currencies],
  );

  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

export function useCountry() {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error('useCountry must be used within a CountryProvider');
  return ctx;
}
