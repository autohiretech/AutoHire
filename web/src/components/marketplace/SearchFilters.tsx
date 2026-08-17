import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ListingFilters } from '@/lib/types';
import { cn } from '@/lib/cn';

/** "More filters" refinement chips → the ListingFilters patch each one applies.
 * Shared by every page that offers the traditional (non-AI) filter row, so
 * Home and the full search results page can't drift into offering different
 * filters for what's meant to be the same search experience. */
export const MORE_FILTERS: { label: string; patch: ListingFilters }[] = [
  { label: '⚡ Electric', patch: { fuel: 'electric' } },
  { label: 'Automatic', patch: { transmission: 'automatic' } },
  { label: 'Manual', patch: { transmission: 'manual' } },
  { label: 'Business host', patch: { ownerType: 'business' } },
  { label: 'Individual host', patch: { ownerType: 'individual' } },
  { label: '5+ seats', patch: { minSeats: 5 } },
  { label: '7+ seats', patch: { minSeats: 7 } },
];

export const PRICE_FILTER: { label: string; patch: ListingFilters } = {
  label: 'Under RWF 50k/day',
  patch: { maxPriceRwf: 50000 },
};

export type PanelId = 'type' | 'price' | 'more' | null;

/** A Getaround-style filter pill that opens a small dropdown panel below it. */
export function FilterPill({
  label,
  active,
  open,
  onToggle,
  children,
}: {
  label: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-sm transition-all',
          active || open
            ? 'border-brand-500 bg-brand-50 text-brand-700'
            : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:shadow',
        )}
      >
        {label}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="absolute left-0 top-full z-40 mt-2 rounded-xl border border-ink-100 bg-white shadow-xl ring-1 ring-black/[0.03]">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700'
          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50',
      )}
    >
      {children}
    </button>
  );
}
