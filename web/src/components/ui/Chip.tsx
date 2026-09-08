import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * A filter or category toggle — the row that sits under the search bar
 * ("Price", "Vehicle type", "Seats"), and the segmented pair on Trips
 * ("Upcoming" / "Ended").
 *
 * Selected state is carried by **fill and weight, not hue**. An active chip
 * inverts to the solid dark surface rather than turning green, which keeps the
 * accent free for the one action on the screen. This is the single most
 * repeated control in the app, so a green one would put the accent on screen a
 * dozen times at once and it would stop meaning anything.
 *
 * The row that holds these scrolls horizontally and must not wrap — a wrapping
 * filter row silently doubles the header height on a small phone and pushes
 * the results below the fold.
 */
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ className, selected = false, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] px-3.5',
        'text-body-sm font-semibold whitespace-nowrap transition-colors duration-150',
        selected
          ? 'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
          : 'border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The horizontally scrolling track chips live in. Edge-to-edge on mobile so
 * the first chip aligns with the page gutter but the row can still scroll past
 * it, with the scrollbar hidden — a visible bar under a row of pills reads as
 * a broken layout rather than an affordance.
 */
export function ChipRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
}
