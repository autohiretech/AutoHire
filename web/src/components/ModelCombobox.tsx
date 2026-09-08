import { useEffect, useRef, useState } from 'react';
import { Search, Zap } from 'lucide-react';
import { CAR_MODELS, searchCarModels, type CarModel } from '@/lib/carModels';
import { cn } from '@/lib/cn';

const FUEL_LABEL: Record<CarModel['fuel'], string> = {
  electric: 'Electric',
  hybrid: 'Hybrid',
  petrol: 'Petrol',
  diesel: 'Diesel',
};

/**
 * Searchable car-model picker. Electric models are listed first and badged.
 * Choosing one hands the full CarModel back so the form can auto-fill the make,
 * model and fuel. Hosts who can't find their car just keep typing in the normal
 * make/model fields below.
 */
export function ModelCombobox({ onSelect }: { onSelect: (m: CarModel) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = query.trim() ? searchCarModels(query, 8) : searchCarModels('', 8);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function choose(m: CarModel) {
    onSelect(m);
    setQuery(`${m.make} ${m.model}`);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={`Search ${CAR_MODELS.length}+ car models…`}
        className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] py-2 pl-9 pr-3 text-body-sm text-[var(--color-content)] focus:border-[var(--color-accent-on)] focus:outline-none"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && results.length > 0 && (
        <ul className="animate-popover-in absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-1 shadow-[var(--shadow-float)]">
          {results.map((m, i) => {
            const electric = m.fuel === 'electric';
            return (
              <li key={`${m.make}-${m.model}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(m)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm',
                    i === active ? 'bg-[var(--color-surface-sunken)]' : '',
                  )}
                >
                  {electric ? (
                    <Zap size={15} className="shrink-0 text-[var(--color-accent-on)]" />
                  ) : (
                    <span className="w-[15px] shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[var(--color-content)]">
                    <span className="font-medium">{m.make}</span> {m.model}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-[var(--radius-pill)] px-2 py-0.5 text-caption font-medium',
                      electric
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                        : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
                    )}
                  >
                    {FUEL_LABEL[m.fuel]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
