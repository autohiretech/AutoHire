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
    // `sm:relative`, not `relative`: below `sm` this wrapper is deliberately
    // NOT a containing block, so the panel below resolves against the sticky
    // <header> and can span the screen. Anchored to this button instead, a
    // 304px right-aligned panel started at -54px on a 390px screen — the
    // country list ran off the left edge with its labels cut in half.
    <div ref={ref} className="sm:relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          // Same shrinkability fix as CountrySelector: this sits next to it
          // (plus a hamburger) in the mobile header, and without min-w-0 +
          // shrink the pair refuses to compress and pushes the header wider
          // than the viewport.
          'flex min-w-0 shrink items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-body-sm text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]',
          open && 'bg-[var(--color-surface-sunken)]',
        )}
      >
        <Coins size={15} className="hidden shrink-0 text-[var(--color-content-subtle)] sm:block" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-content-subtle)]">Prices in</span>
          <span className="font-medium text-[var(--color-content)]">{currency}</span>
        </span>
        <span className="shrink-0 font-medium text-[var(--color-content)] sm:hidden">{currency}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-[var(--color-content-subtle)] transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="animate-popover-in absolute inset-x-3 top-full z-40 origin-top overflow-hidden rounded-[var(--radius-sheet)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)] sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1.5 sm:w-64 sm:origin-top-right">
          <div className="border-b border-[var(--color-line)] p-2.5">
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2.5 py-2 transition-colors focus-within:border-[var(--color-accent-on)] focus-within:bg-[var(--color-surface-raised)]">
              <Search size={15} className="shrink-0 text-[var(--color-content-subtle)]" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search currencies…"
                className="w-full bg-transparent text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setActiveIndex(0);
                    searchRef.current?.focus();
                  }}
                  className="shrink-0 rounded-[var(--radius-pill)] p-0.5 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-content-muted)]"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Said here because this is the moment someone forms the belief.
              "Prices in USD" is easy to read as "I will pay in USD", and
              nothing in this panel corrected that — you picked a currency and
              every price on the site changed, which looks exactly like a
              billing setting. It isn't one: the charge currency is chosen at
              checkout and defaults to the car's own (PayholdPayment's "Pay
              in" select). Wording deliberately echoes that screen's
              "Charged in …" vocabulary so the two read as one system. */}
          <p className="border-b border-[var(--color-line)] px-3 py-2 text-caption text-[var(--color-content-muted)]">
            Changes how prices are shown here only. You choose the currency you&rsquo;re charged in at
            checkout.
          </p>

          <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-body-sm text-[var(--color-content-subtle)]">
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
                        'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-body-sm transition-colors',
                        focused && 'bg-[var(--color-surface-sunken)]',
                      )}
                    >
                      <span className="w-5 shrink-0 text-center text-base leading-none">{c.flag}</span>
                      <span
                        className={cn(
                          'flex-1 truncate font-medium',
                          active ? 'text-[var(--color-content)]' : 'text-[var(--color-content-muted)]',
                        )}
                      >
                        {c.currency}
                      </span>
                      <span className="shrink-0 truncate text-caption text-[var(--color-content-subtle)]">
                        {c.name}
                      </span>
                      {active && <Check size={15} className="shrink-0 text-[var(--color-content)]" />}
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
