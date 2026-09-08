import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RatingProps {
  value?: number | null; // 0..5; null/undefined for a not-yet-rated host or car
  count?: number | null;
  size?: number;
  className?: string;
}

export function Rating({ value, count, size = 14, className }: RatingProps) {
  const hasRating = value != null && (count == null || count > 0);
  return (
    <span className={cn('inline-flex items-center gap-1 text-body-sm text-[var(--color-content-muted)]', className)}>
      <Star size={size} className="fill-[var(--color-accent-on)] text-[var(--color-accent-on)]" />
      {hasRating ? (
        <>
          <span className="font-medium">{(value as number).toFixed(1)}</span>
          {count != null && <span className="tabular text-[var(--color-content-subtle)]">({count})</span>}
        </>
      ) : (
        <span className="text-[var(--color-content-subtle)]">New</span>
      )}
    </span>
  );
}
