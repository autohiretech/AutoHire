import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCountry, type Country } from '@/lib/country';
import { client } from '@/lib/client';

interface RowProps {
  country: Country;
  carCount: number;
  active: boolean;
  focused: boolean;
  onHover: () => void;
  onChoose: () => void;
}

function CountryRow({ country: c, carCount, active, focused, onHover, onChoose }: RowProps) {
  const hasCars = carCount > 0;
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-active={focused}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-body-sm transition-colors',
        focused && 'bg-[var(--color-surface-sunken)]',
      )}
    >
      <span className={cn('w-5 shrink-0 text-center text-base leading-none', !hasCars && 'opacity-40')}>
        {c.flag}
      </span>
      {/* Selected state is the trailing check mark, not a colour fill —
          fill+hue here would spend the page's one accent on a list row. */}
      <span
        className={cn(
          'flex-1 truncate font-medium',
          active
            ? 'text-[var(--color-content)]'
            : hasCars
              ? 'text-[var(--color-content-muted)]'
              : 'text-[var(--color-content-subtle)]',
        )}
      >
        {c.name}
      </span>
      {hasCars ? (
        <span className="tabular shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-content-muted)]">
          {carCount}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-[var(--color-content-subtle)]">No cars yet</span>
      )}
      {active && <Check size={15} className="shrink-0 text-[var(--color-content)]" />}
    </button>
  );
}

/**
 * Alibaba/Amazon-style region control ("Deliver to 🇷🇼 Rwanda ▾"). Lives in the
 * global header so renters pick their country anywhere in the app. Closes on
 * outside-click or Escape; the choice persists in localStorage.
 *
 * PayHold serves dozens of markets, so the list is searchable and grouped:
 * countries with listings sort to the top (busiest first), everything else
 * collapses under a muted "not available yet" section. Picking one of those
 * still works — it just won't show a catalogue.
 */
export function CountrySelector() {
  const { country, setCountry, countries } = useCountry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const countsQuery = useQuery({
    queryKey: ['listingCountsByCountry'],
    queryFn: () => client.listingCountsByCountry(),
    staleTime: 5 * 60 * 1000,
  });
  const counts = countsQuery.data;

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

  // Countries with at least one car sort first (busiest market first), then
  // countries with none, alphabetically — so an empty market never buries one
  // that's actually worth browsing.
  const sorted = useMemo(() => {
    return [...countries].sort((a, b) => {
      const ca = counts?.[a.code] ?? 0;
      const cb = counts?.[b.code] ?? 0;
      if (ca > 0 && cb === 0) return -1;
      if (ca === 0 && cb > 0) return 1;
      if (ca !== cb) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [countries, counts]);

  // Search filtering preserves `sorted`'s order, so the has-cars countries stay
  // a contiguous prefix — `available`/`unavailable` below can split on that
  // without re-sorting or re-scanning per row.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [sorted, query]);

  const available = filtered.filter((c) => (counts?.[c.code] ?? 0) > 0);
  const unavailable = filtered.filter((c) => (counts?.[c.code] ?? 0) === 0);

  function choose(code: string) {
    setCountry(code);
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
      if (pick) choose(pick.code);
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
          // min-w-0 + shrink: this trigger sits next to the currency trigger
          // and a hamburger in the mobile header — without them the row
          // refuses to shrink below its content width and forces the page
          // wider than the viewport (clipping the hamburger, and causing a
          // horizontal scroll on every non-full-bleed route).
          'flex min-w-0 shrink items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-body-sm text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]',
          open && 'bg-[var(--color-surface-sunken)]',
        )}
      >
        <MapPin size={15} className="hidden shrink-0 text-[var(--color-content-subtle)] sm:block" />
        <span className="shrink-0 text-base leading-none">{country.flag}</span>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-content-subtle)]">Country</span>
          <span className="truncate font-medium text-[var(--color-content)]">{country.name}</span>
        </span>
        {/* Mobile: flag + short code only, not the full country name — the
            name alone was wide enough (with the currency trigger and the
            hamburger alongside it) to push the header past the viewport. */}
        <span className="truncate max-w-[6rem] font-medium text-[var(--color-content)] sm:hidden">
          {country.code}
        </span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-[var(--color-content-subtle)] transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="animate-popover-in absolute right-0 z-40 mt-1.5 w-[19rem] origin-top-right overflow-hidden rounded-[var(--radius-sheet)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
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
                placeholder="Search countries…"
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

          <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-body-sm text-[var(--color-content-subtle)]">
                No countries match &ldquo;{query}&rdquo;
              </p>
            ) : (
              <>
                {available.length > 0 && (
                  <>
                    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                      Cars available · {available.length}
                    </p>
                    <div className="space-y-0.5">
                      {available.map((c, i) => (
                        <CountryRow
                          key={c.code}
                          country={c}
                          carCount={counts?.[c.code] ?? 0}
                          active={c.code === country.code}
                          focused={i === activeIndex}
                          onHover={() => setActiveIndex(i)}
                          onChoose={() => choose(c.code)}
                        />
                      ))}
                    </div>
                  </>
                )}
                {unavailable.length > 0 && (
                  <>
                    <p
                      className={cn(
                        'px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]',
                        available.length > 0 && 'mt-1.5 border-t border-[var(--color-line)] pt-2.5',
                      )}
                    >
                      Not available yet · {unavailable.length}
                    </p>
                    <div className="space-y-0.5">
                      {unavailable.map((c, i) => {
                        const index = available.length + i;
                        return (
                          <CountryRow
                            key={c.code}
                            country={c}
                            carCount={0}
                            active={c.code === country.code}
                            focused={index === activeIndex}
                            onHover={() => setActiveIndex(index)}
                            onChoose={() => choose(c.code)}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
