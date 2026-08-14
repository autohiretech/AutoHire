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
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        focused && 'bg-ink-50',
        active && 'bg-brand-50',
      )}
    >
      <span className={cn('w-5 shrink-0 text-center text-base leading-none', !hasCars && 'opacity-40')}>
        {c.flag}
      </span>
      <span
        className={cn(
          'flex-1 truncate font-medium',
          active ? 'text-ink-900' : hasCars ? 'text-ink-800' : 'text-ink-400',
        )}
      >
        {c.name}
      </span>
      {hasCars ? (
        <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand-700">
          {carCount}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-ink-300">No cars yet</span>
      )}
      {active && <Check size={15} className="shrink-0 text-brand-600" />}
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
        <div className="animate-popover-in absolute right-0 z-40 mt-1.5 w-[19rem] origin-top-right overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl ring-1 ring-black/5">
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
                placeholder="Search countries…"
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
                No countries match &ldquo;{query}&rdquo;
              </p>
            ) : (
              <>
                {available.length > 0 && (
                  <>
                    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
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
                        'px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-300',
                        available.length > 0 && 'mt-1.5 border-t border-ink-100 pt-2.5',
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
