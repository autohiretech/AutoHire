import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type TranslationKey } from './en';
import { rw } from './rw';

export type Language = 'en' | 'rw';

export const LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'rw', label: 'Ikinyarwanda', short: 'RW' },
];

const DICTIONARIES: Record<Language, Record<string, string>> = { en, rw };
const STORAGE_KEY = 'autohire.language';

/**
 * Which language the *app itself* speaks. Deliberately separate from
 * `useCountry` — a Rwandan abroad still wants Kinyarwanda while browsing the
 * UAE market, and a visitor in Kigali still wants English. Tying the two
 * together would make one of those impossible.
 *
 * Not tied to a signed-in profile either: a guest reading the home page needs
 * this to work before they have an account, and it is a device preference the
 * way theme is, so it lives in localStorage like `autohire.country` does.
 */
interface LanguageContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  /** Look up a UI string, substituting `{name}` placeholders. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  try {
    // `?lang=rw` on the URL wins, and is persisted exactly as the switcher
    // would persist it. A link can then carry its language — support sending
    // a Kinyarwanda link to a Kinyarwanda speaker, a WhatsApp share landing
    // in the reader's language rather than the sharer's — and the choice
    // survives the first in-app navigation instead of snapping back to
    // whatever this device last used. Only the two real codes count;
    // anything else is ignored rather than trusted.
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl === 'en' || fromUrl === 'rw') {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'rw') return saved;
    // No stored choice: follow the browser. `rw-RW` or a bare `rw` both mean
    // this reader asked for Kinyarwanda before we ever showed them anything.
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('rw')) return 'rw';
  } catch {
    // Private mode / storage blocked — fall through to the default.
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLanguage);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this page view, it just won't persist.
    }
  }, []);

  // Keep the document in sync: screen readers announce content in the
  // language `<html lang>` claims, and getting it wrong makes Kinyarwanda
  // read aloud with English pronunciation rules.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      // English is the fallback, never the raw key: a missing translation
      // should degrade to a word the reader can still act on, not to
      // "car.reserve" on a button. The typed `rw` makes this rare, but a
      // locale added later shouldn't be able to blank the UI.
      const template = DICTIONARIES[lang][key] ?? en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in vars ? String(vars[name]) : whole,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}

/** Shorthand for the common case — `const t = useT()` then `t('nav.trips')`. */
export function useT() {
  return useLanguage().t;
}

/**
 * Is this string one of the dictionary's keys? For labels built from a value
 * the API supplied (`fuel.${listing.fuel}`): the type system can promise the
 * enum's known members are all covered, but a row written by a newer
 * migration can carry a value this build has never heard of, and `t()` on an
 * unknown key returns the key itself — "fuel.lpg" on a card. Callers check
 * here first and fall back to showing the raw value.
 */
export function isTranslationKey(key: string): key is TranslationKey {
  return key in en;
}

export type { TranslationKey };
