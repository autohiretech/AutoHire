import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LANGUAGES, useLanguage } from '@/lib/i18n';

/**
 * App-language picker ("Language EN ▾"), sitting beside the market and
 * currency selectors it deliberately does not depend on: language is what the
 * app speaks to you, country is which cars you see, currency is what prices
 * are shown in. A Rwandan browsing the UAE market still wants Kinyarwanda.
 *
 * Two entries, so no search box — unlike CurrencySelector, whose list is
 * every currency PayHold serves. If a third language is ever added this
 * should stay a plain list until it isn't scannable at a glance.
 */
export function LanguageSelector() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className={cn(
          // Same min-w-0 + shrink as the two selectors beside it — three
          // controls plus a hamburger in a 390px header only fit if each one
          // is willing to compress.
          'flex min-w-0 shrink items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-body-sm text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]',
          open && 'bg-[var(--color-surface-sunken)]',
        )}
      >
        <Languages size={15} className="hidden shrink-0 text-[var(--color-content-subtle)] sm:block" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-content-subtle)]">Language</span>
          <span className="font-medium text-[var(--color-content)]">{current.short}</span>
        </span>
        <span className="shrink-0 font-medium text-[var(--color-content)] sm:hidden">{current.short}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-[var(--color-content-subtle)] transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="animate-popover-in absolute right-0 z-40 mt-1.5 w-48 origin-top-right overflow-hidden rounded-[var(--radius-sheet)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]"
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={l.code === lang}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-body-sm text-[var(--color-content)] transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              {/* Each language is named in itself — someone who only reads
                  Kinyarwanda should not have to recognise the English word
                  "Kinyarwanda" to find their own language. */}
              <span>{l.label}</span>
              {l.code === lang && <Check size={15} className="shrink-0 text-[var(--color-accent-on)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
