import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Fields are 44px and sit on a sunken surface rather than a bordered white
 * box. On a phone that reads as "type here" without a hard 1px outline around
 * every field, and it keeps a form from looking like a grid of boxes.
 *
 * The focus ring is the accent — one of the few places the accent appears
 * without being a button, because "where am I typing" is worth the emphasis.
 */
const baseField = cn(
  'h-11 w-full rounded-[var(--radius-control)] px-3.5 text-body-sm',
  'border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)]',
  'text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)]',
  'focus:border-[var(--color-accent-on)] focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(baseField, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(baseField, 'pr-8', className)} {...props} />;
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'mb-1.5 block text-body-sm font-semibold text-[var(--color-content)]',
        className,
      )}
      {...props}
    />
  );
}
