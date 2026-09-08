import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The one loading indicator for in-flight actions too short-lived to justify
 * a skeleton — a button mid-submit, a small inline fetch. Anything that owns
 * a chunk of layout (a page body, a list) should reach for `Skeleton`
 * instead; see its own file for why.
 */
type SpinnerSize = 'sm' | 'md' | 'lg';

const sizes: Record<SpinnerSize, number> = {
  sm: 14,
  md: 20,
  lg: 28,
};

export function Spinner({
  className,
  size = 'md',
}: {
  className?: string;
  size?: SpinnerSize | number;
}) {
  const px = typeof size === 'number' ? size : sizes[size];
  return (
    <Loader2 size={px} className={cn('animate-spin text-[var(--color-accent-on)]', className)} />
  );
}
