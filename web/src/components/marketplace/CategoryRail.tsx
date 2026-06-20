import type { CarCategory } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES } from '@/lib/categories';

/**
 * Horizontally scrollable category tiles, Alibaba-style. Selecting a tile sets
 * the active category filter; clicking the active tile again clears it.
 */
export function CategoryRail({
  value,
  onSelect,
}: {
  value?: CarCategory;
  onSelect: (category?: CarCategory) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-3 pb-1">
        {CAR_CATEGORIES.map(({ value: cat, label, icon: Icon }) => {
          const active = value === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onSelect(active ? undefined : cat)}
              aria-pressed={active}
              className={cn(
                'flex w-20 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors',
                active
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50',
              )}
            >
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full',
                  active ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
                )}
              >
                <Icon size={20} />
              </span>
              <span className="text-xs font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
