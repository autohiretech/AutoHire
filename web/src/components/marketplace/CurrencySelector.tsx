import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, Coins, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';

/**
 * Display-currency picker ("Prices in USD ▾"). Independent of the market
 * selector next to it — switching currency here just re-renders every price
 * on screen via live FX (see `Price.tsx`); it never changes which country's
 * cars are shown, and it never touches what a booking actually charges (that
 * stays the listing's own currency; PayHold separately picks the renter's
 * real charge currency from their account country at checkout).
 *
 * The list is every currency PayHold currently serves (from `useCountry`'s
 * live `currencies`, sourced from PayHold's own payment-options) — so nothing
 * offered here is a currency AutoHire could actually charge a booking in.
 */
export function CurrencySelector() {
  const { currency, setCurrency, currencies } = useCountry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const sorted = useMemo(
    () => [...currencies].sort((a, b) => a.currency.localeCompare(b.currency)),
    [currencies],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.currency.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [sorted, query]);

  function choose(code: string) {
    setCurrency(code);
    setOpen(false);
  }

  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[activeIndex];
      if (pick) choose(pick.currency);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

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
        <Coins size={15} className="hidden text-ink-400 sm:block" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-[10px] uppercase tracking-wide text-ink-400">Prices in</span>
          <span className="font-medium text-ink-800">{currency}</span>
        </span>
        <span className="font-medium text-ink-800 sm:hidden">{currency}</span>
        <ChevronDown size={14} className={cn('text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="animate-popover-in absolute right-0 z-40 mt-1.5 w-64 origin-top-right overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl ring-1 ring-black/5">
          <div className="border-b border-ink-100 p-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-2 transition-colors focus-within:border-brand-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100">
              <Search size={15} className="shrink-0 text-ink-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search currencies…"
                className="w-full bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setActiveIndex(0);
                    searchRef.current?.focus();
                  }}
                  className="shrink-0 rounded-full p-0.5 text-ink-400 hover:bg-ink-200 hover:text-ink-600"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-400">
                No currencies match &ldquo;{query}&rdquo;
              </p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((c, i) => {
                  const active = c.currency === currency;
                  const focused = i === activeIndex;
                  return (
                    <button
                      key={c.currency}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={focused}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(c.currency)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        focused && 'bg-ink-50',
                        active && 'bg-brand-50',
                      )}
                    >
                      <span className="w-5 shrink-0 text-center text-base leading-none">{c.flag}</span>
                      <span className={cn('flex-1 truncate font-medium', active ? 'text-ink-900' : 'text-ink-700')}>
                        {c.currency}
                      </span>
                      <span className="shrink-0 truncate text-xs text-ink-400">{c.name}</span>
                      {active && <Check size={15} className="shrink-0 text-brand-600" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
