import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import type { CarCategory } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES } from '@/lib/categories';

/**
 * Horizontally scrollable category tiles, Alibaba-style. Selecting a tile sets
 * the active category filter; clicking the active tile again clears it. Arrow
 * buttons appear at whichever edge still has more tiles to reveal, so the rail
 * is drivable without a swipe (and stay hidden when there's nothing to scroll).
 */
export function CategoryRail({
  value,
  onSelect,
}: {
  value?: CarCategory;
  onSelect: (category?: CarCategory) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Recompute which arrows apply from the current scroll position.
  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    update();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  const nudge = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const arrow =
    'absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full ' +
    'border border-ink-200 bg-white text-ink-700 shadow-card transition hover:bg-ink-50 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';

  return (
    <div className="relative">
      {canLeft && (
        <button type="button" onClick={() => nudge(-1)} aria-label="Scroll categories left" className={cn(arrow, 'left-0')}>
          <ChevronLeft size={18} />
        </button>
      )}

      <div
        ref={scroller}
        className="-mx-4 overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex gap-3 pb-1">
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            aria-pressed={!value}
            className={cn(
              'flex w-20 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors',
              !value
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50',
            )}
          >
            <span
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full',
                !value ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
              )}
            >
              <LayoutGrid size={20} />
            </span>
            <span className="text-xs font-medium">All</span>
          </button>
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

      {canRight && (
        <button type="button" onClick={() => nudge(1)} aria-label="Scroll categories right" className={cn(arrow, 'right-0')}>
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}
