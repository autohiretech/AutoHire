import { useEffect, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const STYLE_ID = 'ah-skeleton-styles';
const CSS = `
.ah-skeleton {
  position: relative;
  overflow: hidden;
}
.ah-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, var(--color-line-strong), transparent);
  animation: ah-skeleton-shimmer 1.6s ease-in-out infinite;
}
@keyframes ah-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ah-skeleton::after {
    animation: none;
  }
}
`;

/** Inserted once, no matter how many `<Skeleton>` instances mount at once —
 * a skeleton list can easily be a dozen of these on screen together, and a
 * `<style>` tag per instance would mean a dozen duplicate stylesheets. */
function useSkeletonStyle() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

/**
 * A placeholder block for content that hasn't loaded yet — a line of text, an
 * avatar, a card. Sized entirely by the className the caller passes
 * (`<Skeleton className="h-4 w-32" />`); this component only supplies the
 * fill, radius and shimmer.
 *
 * Prefer this over `Spinner` for anything that owns a chunk of layout — a
 * page body, a list, a card grid — since a shape in the right place reads as
 * "here's what's coming" rather than a blank screen with a spinner floating
 * in the middle of it. `Spinner` stays right for small in-flight actions
 * (buttons, inline fetches) that don't have a layout of their own to preview.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  useSkeletonStyle();
  return (
    <div
      className={cn(
        'ah-skeleton rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)]',
        className,
      )}
      {...props}
    />
  );
}
