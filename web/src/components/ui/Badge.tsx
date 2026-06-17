import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  neutral: 'bg-ink-100 text-ink-700',
  accent: 'bg-amber-50 text-amber-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-orange-50 text-orange-700',
  danger: 'bg-red-50 text-red-700',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
