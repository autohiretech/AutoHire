import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="animate-overlay-in absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // **Capped and scrollable.** Without a height limit a tall dialog
          // simply grows past the viewport, and because it is centred it
          // overflows at *both* ends — the title disappears off the top and
          // the primary action off the bottom, with nothing to scroll because
          // the page behind it is locked. The payout form was the first
          // content long enough to show it; every modal had the bug.
          //
          // `dvh` rather than `vh` so a phone's collapsing address bar does
          // not leave the last control under the browser chrome.
          'animate-sheet-in relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[var(--radius-sheet)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-sheet)] sm:animate-popover-in sm:max-h-[88dvh] sm:rounded-[var(--radius-sheet)] sm:shadow-[var(--shadow-float)]',
          className,
        )}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
            <h2 className="text-h4 text-[var(--color-content)]">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-[var(--radius-control)] p-1 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {/* The scrolling half. `min-h-0` is what actually lets it shrink —
            a flex child defaults to `min-height: auto` and refuses to be
            smaller than its content, which silently defeats the cap above. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
