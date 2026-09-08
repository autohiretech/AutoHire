import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The grouped settings list — Profile / Payments / Payment methods, and every
 * other "here are your options" screen (Account, Verification, Payout setup).
 *
 * The grouping is the point. One rounded container with hairline dividers
 * *inside* it says "these belong together"; the same rows as separate cards
 * say "these are unrelated" and cost a border and a gap each to say it. This
 * is the pattern every native settings screen uses, for that reason.
 */
export function ListGroup({
  label,
  className,
  children,
}: {
  /** Optional section caption, above the group. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {label && (
        <h2 className="px-1 text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
          {label}
        </h2>
      )}
      {/* Dividers come from the children so the first row has none — a border
          on every row would double up against the container's own edge. */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]">
        {children}
      </div>
    </section>
  );
}

export interface ListRowProps {
  icon?: ReactNode;
  children: ReactNode;
  /** Right-hand text — a current value, a status, a count. */
  value?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Hides the chevron for rows that don't navigate. */
  chevron?: boolean;
  className?: string;
}

export function ListRow({
  icon,
  children,
  value,
  to,
  onClick,
  chevron = true,
  className,
}: ListRowProps) {
  const interactive = Boolean(to || onClick);

  const inner = (
    <>
      {icon && (
        <span className="flex size-9 shrink-0 items-center justify-center text-[var(--color-content-muted)]">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-[var(--color-content)]">
        {children}
      </span>
      {value && (
        <span className="shrink-0 text-body-sm text-[var(--color-content-muted)]">{value}</span>
      )}
      {interactive && chevron && (
        <ChevronRight className="size-4 shrink-0 text-[var(--color-content-subtle)]" />
      )}
    </>
  );

  const classes = cn(
    'flex w-full items-center gap-3 px-4 py-3.5 text-left',
    'border-t border-[var(--color-line)] first:border-t-0',
    interactive && 'transition-colors hover:bg-[var(--color-surface-sunken)]',
    className,
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {inner}
      </button>
    );
  }
  return <div className={classes}>{inner}</div>;
}
