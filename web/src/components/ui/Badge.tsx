import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * A small, non-interactive label describing what something *is*.
 *
 * Two families, and the distinction matters:
 *
 * • `overlay` sits on top of a photograph ("Instant book", "Business host").
 *   It is opaque near-black on white rather than tinted, because a tint over
 *   an unknown photo is unreadable — the image behind it could be any colour.
 * • the tonal tones sit on a surface, where the tint has a known ground.
 *
 * A badge never carries the accent. The accent means "act"; a badge is a
 * statement of fact, and a green one would read as a button that lost its
 * click.
 */
type Tone =
  | 'neutral'
  | 'brand'
  | 'warn'
  | 'info'
  | 'danger'
  | 'overlay'
  /* Transitional aliases — see below. */
  | 'success'
  | 'warning'
  | 'accent';

const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  warn: 'bg-[var(--color-warn-tint)] text-[var(--color-warn-500)]',
  info: 'bg-[var(--color-info-tint)] text-[var(--color-info-500)]',
  danger: 'bg-[var(--color-danger-tint)] text-[var(--color-danger-500)]',
  // Fixed colours on purpose: this one lives over photography, where the
  // theme's surface tokens say nothing about the ground behind it.
  overlay: 'bg-white/95 text-ink-900 backdrop-blur-sm',

  // ── Transitional aliases ────────────────────────────────────────────────
  // ~40 call sites predate the token rework and are being migrated page by
  // page. They resolve to the new tones rather than the old palette, so the
  // app is visually consistent *now* and the rename is a mechanical follow-up
  // rather than a flag day. `success` maps to brand deliberately: positive and
  // brand are the same hue here, which is why there is no separate green.
  success: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  warning: 'bg-[var(--color-warn-tint)] text-[var(--color-warn-500)]',
  accent: 'bg-[var(--color-warn-tint)] text-[var(--color-warn-500)]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1',
        'text-caption font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
