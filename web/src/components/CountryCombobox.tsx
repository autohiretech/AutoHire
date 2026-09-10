import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface CountryOption {
  code: string;
  name: string;
  flag?: string;
}

/**
 * Pick a country by typing, not by scrolling.
 *
 * The payout country was a native `<select>` over ~200 entries. On desktop
 * that is a long scroll; on a phone it is the OS wheel picker, where finding
 * "Nigeria" means dragging through the alphabet with no way to type. Either
 * way the host already knows the answer and the control makes them hunt for
 * it — and this is the field that decides which payout methods and which
 * currency they are offered, so it is worth getting to quickly.
 *
 * Matching is deliberately loose: name prefix, name substring, or the two
 * letter code, so "ng", "nige" and "Nigeria" all land. A code match ranks
 * first because someone typing "NG" means the code.
 *
 * **The results render in normal flow rather than as an absolute overlay.**
 * That is the opposite of `ModelCombobox`, on purpose: this sits inside a
 * modal whose body scrolls, and an absolutely-positioned list inside a
 * scrolling container is clipped at its edge — on a phone, that hides most of
 * the results with no indication they exist. In flow it simply grows and the
 * modal scrolls it into view, which behaves the same on both.
 */
export function CountryCombobox({
  countries,
  onSelect,
  disabled,
  placeholder = 'Search countries…',
  autoFocus,
}: {
  countries: CountryOption[];
  onSelect: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    const scored = countries
      .map((c) => {
        const name = c.name.toLowerCase();
        const code = c.code.toLowerCase();
        // Lower is better. A code match wins: someone typing "NG" means NG,
        // not "Northern Mariana Islands".
        if (code === q) return { c, rank: 0 };
        if (name.startsWith(q)) return { c, rank: 1 };
        if (name.includes(q)) return { c, rank: 2 };
        if (code.startsWith(q)) return { c, rank: 3 };
        return null;
      })
      .filter((x): x is { c: CountryOption; rank: number } => x !== null);
    scored.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
    return scored.map((x) => x.c);
  }, [countries, query]);

  // Typing changes what is under the cursor, so the highlight follows the list
  // rather than staying on whatever index it happened to be.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div>
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className="pl-9"
          // `search` rather than `text`: on a phone it puts a search key on
          // the keyboard instead of a newline, and no autocorrect mangling a
          // half-typed country name into a word.
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls="country-results"
          aria-label="Search countries"
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
              if (pick) onSelect(pick.code);
            }
          }}
        />
      </div>

      <ul
        id="country-results"
        ref={listRef}
        role="listbox"
        aria-label="Countries"
        className="mt-2 max-h-56 overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-[var(--color-line)]"
      >
        {results.length === 0 && (
          <li className="px-3 py-3 text-body-sm text-[var(--color-content-muted)]">
            No country matches “{query.trim()}”.
          </li>
        )}
        {results.map((c, i) => (
          <li key={c.code}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              disabled={disabled}
              // `onMouseDown` rather than `onClick`: the input is focused, and
              // a click first blurs it — which on some mobile browsers closes
              // the keyboard and shifts the layout out from under the finger
              // before the click resolves, so the tap lands on the wrong row.
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(c.code);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2.5 text-left text-body-sm',
                // Comfortably tappable rather than a dense desktop row.
                i === active
                  ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]'
                  : 'text-[var(--color-content)]',
              )}
            >
              {c.flag && <span aria-hidden>{c.flag}</span>}
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-caption text-[var(--color-content-subtle)]">{c.code}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
