import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * A surface that holds related content.
 *
 * **No shadow by default, and no border on the photo-led variant.** A listing
 * card is a photograph, and a photograph already has an edge; wrapping it in a
 * border *and* a shadow *and* a radius spends three separate "this is a
 * separate object" signals on something that needed none. Shadow is reserved
 * for surfaces that genuinely float (`Sheet`, popovers, the map's floating
 * pills), where without it you cannot tell what is on top.
 *
 * `bare` is the photo-led case: radius and clipping only, no chrome at all.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** No border or fill — for cards whose content (usually a photo) is the edge. */
  bare?: boolean;
  /** Lifts on hover. Only for cards that are a single link target. */
  interactive?: boolean;
}

export function Card({ className, bare = false, interactive = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)]',
        !bare &&
          'border border-[var(--color-line)] bg-[var(--color-surface-raised)]',
        interactive &&
          'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-5', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-b border-[var(--color-line)] px-4 py-3 sm:px-5', className)}
      {...props}
    />
  );
}

/**
 * A card that carries a state rather than content — "cars are filling up",
 * "turn on notifications", "payout failed".
 *
 * This is the *only* place the semantic colours are allowed to fill a whole
 * surface. The tone is the message here, which is exactly why it must never
 * be used for an ordinary container: if a plain content card is tinted amber,
 * then amber stops meaning "needs attention" everywhere else in the app.
 */
const noticeTones = {
  warn: 'bg-[var(--color-warn-tint)] text-[var(--color-warn-500)]',
  info: 'bg-[var(--color-info-tint)] text-[var(--color-info-500)]',
  danger: 'bg-[var(--color-danger-tint)] text-[var(--color-danger-500)]',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
} as const;

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof noticeTones;
}

export function Notice({ className, tone = 'info', ...props }: NoticeProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-card)] p-4 text-body-sm',
        noticeTones[tone],
        className,
      )}
      {...props}
    />
  );
}
