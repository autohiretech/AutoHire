import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';

/**
 * Alibaba/Amazon-style region control ("Deliver to 🇷🇼 Rwanda ▾"). Lives in the
 * global header so renters pick their country anywhere in the app. Closes on
 * outside-click or Escape; the choice persists in localStorage.
 */
export function CountrySelector() {
  const { country, setCountry, countries } = useCountry();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-600 transition-colors hover:bg-ink-100',
          open && 'bg-ink-100',
        )}
      >
        <MapPin size={15} className="hidden text-ink-400 sm:block" />
        <span className="text-base leading-none">{country.flag}</span>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-[10px] uppercase tracking-wide text-ink-400">Country</span>
          <span className="font-medium text-ink-800">{country.name}</span>
        </span>
        <span className="font-medium text-ink-800 sm:hidden">{country.name}</span>
        <ChevronDown size={14} className={cn('text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-ink-200 bg-white p-1 shadow-lg"
        >
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">
            Choose your country
          </p>
          {countries.map((c) => {
            const active = c.code === country.code;
            return (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setCountry(c.code);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-ink-50',
                  active ? 'bg-brand-50 text-ink-900' : 'text-ink-800',
                )}
              >
                <span className="text-base leading-none">{c.flag}</span>
                <span className="flex-1 font-medium">{c.name}</span>
                {active && <Check size={16} className="text-brand-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
