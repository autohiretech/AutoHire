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
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
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
        placeholder={`Search ${CAR_MODELS.length}+ models — electric shown first…`}
        className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-ink-200 bg-white py-1 shadow-lg">
          {results.map((m, i) => {
            const electric = m.fuel === 'electric';
            return (
              <li key={`${m.make}-${m.model}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(m)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    i === active ? 'bg-ink-50' : '',
                  )}
                >
                  {electric ? (
                    <Zap size={15} className="shrink-0 text-brand-600" />
                  ) : (
                    <span className="w-[15px] shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink-800">
                    <span className="font-medium">{m.make}</span> {m.model}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      electric ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-500',
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
