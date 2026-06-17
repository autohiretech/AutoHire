import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RatingProps {
  value: number; // 0..5
  count?: number;
  size?: number;
  className?: string;
}

export function Rating({ value, count, size = 14, className }: RatingProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-ink-700', className)}>
      <Star size={size} className="fill-accent-500 text-accent-500" />
      <span className="font-medium">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-ink-400">({count})</span>}
    </span>
  );
}
