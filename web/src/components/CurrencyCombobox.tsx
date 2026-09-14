import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';

/**
 * Pick a currency by typing, not by scrolling 141 of them.
 *
 * The listing form's Currency field was a native `<select>` over every
 * currency PayHold can collect — the tenant's own four plus the home currency
 * of every collectible market, which is 141 codes today and grows whenever
 * PayHold opens a market. A native select has no search: on desktop that is a
 * long scroll past codes nobody recognises, and on a phone it is the OS wheel,
 * where reaching ZAR means dragging through the whole alphabet. The host
 * always knows the answer already — they are pricing their own car — so the
 * control's only job is to get out of the way.
 *
 * Same shape as the header's `CurrencySelector` (a trigger, a search box, a
 * capped scrolling list) because they are the same act, and the same matching
 * rules as `CountryCombobox`: an exact code wins, then the name, so "rw",
 * "rwf" and "Rwanda" all land on RWF.
 *
 * Deliberately NOT a free-text `<input>` like the make/model box: currency is
 * a closed set that the payment rails decide, and a typed code that isn't on
 * the list is a listing nobody can be charged for.
 */
export function CurrencyCombobox({
  id,
  value,
  onChange,
  options,
  /** Rendered with a "your market" note — the country's own currency. */
  suggested,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  options: string[];
  suggested?: string;
  disabled?: boolean;
}) {
  const { currencies } = useCountry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /** Flag and country name for a code, where PayHold's catalogue knows one.
   *  A currency several countries share, or one with no match at all, falls
   *  back to a generic badge whose `name` IS the code — printing that beside
   *  the code gave rows reading "AUD  AUD", so it is dropped rather than
   *  repeated, and the row is just the code. */
  const meta = useMemo(() => {
    const byCode = new Map(currencies.map((c) => [c.currency, c]));
    return options.map((code) => {
      const hit = byCode.get(code);
      return {
        code,
        name: hit && hit.name !== code ? hit.name : '',
        flag: hit?.flag ?? '',
      };
    });
  }, [currencies, options]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meta;
    const scored = meta
      .map((c) => {
        const code = c.code.toLowerCase();
        const name = c.name.toLowerCase();
        if (code === q) return { c, rank: 0 };
        if (code.startsWith(q)) return { c, rank: 1 };
        if (name.startsWith(q)) return { c, rank: 2 };
        if (name.includes(q)) return { c, rank: 3 };
        return null;
      })
      .filter((x): x is { c: (typeof meta)[number]; rank: number } => x !== null);
    scored.sort((a, b) => a.rank - b.rank || a.c.code.localeCompare(b.c.code));
    return scored.map((x) => x.c);
  }, [meta, query]);

  // Opening starts from a clean search on the current choice, not wherever the
  // last one left off.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(Math.max(0, options.indexOf(value)));
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, options, value]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the highlighted row in view — including the pre-selected one when the
  // panel opens on a currency 90 rows down.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function choose(code: string) {
    onChange(code);
    setOpen(false);
  }

  const current = meta.find((c) => c.code === value);

  return (
    <div ref={boxRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          // The same 44px sunken field the Select it replaced used, so it still
          // lines up with the price box beside it.
          'flex h-11 w-full items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-body-sm',
          'border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)]',
          'text-[var(--color-content)] disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-[var(--color-accent-on)]',
        )}
      >
        {current?.flag && (
          <span aria-hidden className="shrink-0">
            {current.flag}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left font-medium">{value}</span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-[var(--color-content-subtle)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        // Right-anchored and wider than the trigger: the field itself is an
        // 11rem column beside the price, too narrow for "United Arab Emirates
        // dirham", and a left-anchored panel that wide would run off the edge
        // of a phone. `w-[min(18rem,calc(100vw-2rem))]` keeps the page from
        // scrolling sideways at 390px.
        <div className="animate-popover-in absolute right-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
          <div className="border-b border-[var(--color-line)] p-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search currencies…"
                aria-label="Search currencies"
                // `search` rather than `text`: a search key on the phone
                // keyboard instead of a newline, and no autocorrect turning
                // "rwf" into a word.
                type="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((i) => Math.min(i + 1, results.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick = results[active];
                    if (pick) choose(pick.code);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
                className={cn(
                  'h-9 w-full rounded-[var(--radius-control)] pl-8 pr-2.5 text-body-sm',
                  'border border-[var(--color-line)] bg-[var(--color-surface-sunken)]',
                  'text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)]',
                  'focus:border-[var(--color-accent-on)] focus:outline-none',
                )}
              />
            </div>
          </div>

          {/* Capped at roughly seven rows. A panel that grows to 141 is a page
              of its own over the rest of the form, and the search box above it
              is the way through a long list — not the scrollbar. */}
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Currencies"
            className="max-h-64 overflow-y-auto overscroll-contain p-1"
          >
            {results.length === 0 && (
              <li className="px-3 py-4 text-center text-body-sm text-[var(--color-content-subtle)]">
                No currency matches “{query.trim()}”.
              </li>
            )}
            {results.map((c, i) => (
              <li key={c.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.code === value}
                  // `onMouseDown` with the default prevented: a click blurs the
                  // search box first, and on a phone that closes the keyboard
                  // and shifts the panel out from under the finger before the
                  // click lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(c.code);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-body-sm',
                    i === active && 'bg-[var(--color-surface-sunken)]',
                  )}
                >
                  <span aria-hidden className="w-5 shrink-0 text-center leading-none">
                    {c.flag}
                  </span>
                  <span className="shrink-0 font-medium text-[var(--color-content)]">{c.code}</span>
                  <span className="min-w-0 flex-1 truncate text-caption text-[var(--color-content-subtle)]">
                    {c.code === suggested ? 'your market' : c.name}
                  </span>
                  {c.code === value && (
                    <Check size={15} className="shrink-0 text-[var(--color-accent-on)]" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
