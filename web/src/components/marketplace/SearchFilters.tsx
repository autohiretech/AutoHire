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

/**
 * A Getaround-style filter pill that opens a small dropdown panel below it.
 *
 * Note: as of the redesign, `SearchResultsPage` uses `ui/Chip` (fill+weight
 * selection) for its filter row instead of this pill and the local `Chip`
 * below — `FilterPill` and `Chip` are currently unused, kept on-token in case
 * a page reaches for a dropdown-style filter again.
 */
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
          'flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-body-sm font-medium transition-all',
          active || open
            ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
            : 'border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
        )}
      >
        {label}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="animate-popover-in absolute left-0 top-full z-40 mt-2 rounded-[var(--radius-sheet)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
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
        'shrink-0 rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-body-sm font-medium transition-colors',
        active
          ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
          : 'border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
      )}
    >
      {children}
    </button>
  );
}
