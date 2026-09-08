import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Composed skeleton shapes for the browse pages (home, search, cities, hosts,
 * watchlist) — each mirrors the real component's box model exactly so the
 * page doesn't jump when data arrives. See `ui/Skeleton` for the primitive.
 */

/** A stack of text-line placeholders. Widths are percentages of the
 * container, so callers control the container width instead of this
 * component guessing at pixels. */
export function TextLines({
  widths,
  className,
  lineClassName,
}: {
  widths: string[];
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {widths.map((w, i) => (
        <Skeleton key={i} className={cn('h-3.5', lineClassName)} style={{ width: w }} />
      ))}
    </div>
  );
}

/** Mirrors `ListingCard` in its default `stacked` layout: a 4:3 photo, a
 * title line, a location line and a price line. */
export function ListingCardSkeleton() {
  return (
    <div className="h-full">
      <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-card)]" />
      <div className="pt-3">
        <Skeleton className="h-4" style={{ width: '70%' }} />
        <Skeleton className="mt-1.5 h-3.5" style={{ width: '45%' }} />
        <Skeleton className="mt-2 h-3.5" style={{ width: '35%' }} />
      </div>
    </div>
  );
}

/** Mirrors `ListingCard` with `layout="row"`: a fixed-width photo beside
 * three lines — used in the search results list. */
export function ListingRowSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="aspect-[4/3] w-32 shrink-0 rounded-[var(--radius-card)] sm:w-40" />
      <div className="min-w-0 flex-1 py-0.5">
        <Skeleton className="h-4" style={{ width: '80%' }} />
        <Skeleton className="mt-1.5 h-3.5" style={{ width: '50%' }} />
        <Skeleton className="mt-2 h-3.5" style={{ width: '40%' }} />
      </div>
    </div>
  );
}

/** Mirrors `HostCard`: a centered avatar circle with three lines under it. */
export function HostCardSkeleton() {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-4">
      <Skeleton className="h-14 w-14 rounded-full" />
      <Skeleton className="mt-2 h-4" style={{ width: '60%' }} />
      <Skeleton className="mt-1.5 h-3" style={{ width: '45%' }} />
      <Skeleton className="mt-2 h-3" style={{ width: '35%' }} />
    </div>
  );
}
