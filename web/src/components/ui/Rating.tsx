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
    <span className={cn('inline-flex items-center gap-1 text-sm text-ink-700', className)}>
      <Star size={size} className="fill-accent-500 text-accent-500" />
      {hasRating ? (
        <>
          <span className="font-medium">{(value as number).toFixed(1)}</span>
          {count != null && <span className="text-ink-400">({count})</span>}
        </>
      ) : (
        <span className="text-ink-400">New</span>
      )}
    </span>
  );
}
