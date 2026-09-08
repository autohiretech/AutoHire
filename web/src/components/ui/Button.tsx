import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * The one control that commits an action.
 *
 * `primary` is the accent, and a screen gets **one** of them — the thing the
 * page exists to do (Book, Continue, Send payout). Everything else on that
 * screen is `secondary` or `ghost`. That constraint is the whole reason the
 * accent reads as urgent when it does appear; a page with four green buttons
 * has no primary action, it has four suggestions.
 *
 * `pill` matches the floating map/list toggles and filter chips, which are
 * round-ended because they toggle rather than commit.
 */
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Round-ended, for toggles and floating controls rather than commits. */
  pill?: boolean;
}

const variants: Record<Variant, string> = {
  // `accent-on` rather than a fixed brand step: on a dark ground brand-600
  // fails contrast and stops looking clickable, so the token promotes itself.
  primary: 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] hover:opacity-90',
  // The inverse button — high contrast, no hue. For actions that are important
  // but are not *the* action, so they don't compete with the accent.
  secondary:
    'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)] hover:opacity-90',
  outline:
    'border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]',
  ghost: 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
  danger: 'bg-[var(--color-danger-500)] text-white hover:opacity-90',
};

// Heights sit on the 4px grid and never go below 40px on the two sizes a
// thumb is expected to hit — these screens are used one-handed, on a phone,
// often while standing next to the car.
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-body-sm',
  md: 'h-11 px-5 text-body-sm',
  lg: 'h-13 px-7 text-body',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', pill = false, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 font-semibold transition-[opacity,background-color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pill ? 'rounded-[var(--radius-pill)]' : 'rounded-[var(--radius-control)]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
