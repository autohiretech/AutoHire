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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="animate-overlay-in absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'animate-sheet-in relative z-10 w-full max-w-lg rounded-t-[var(--radius-sheet)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-sheet)] sm:animate-popover-in sm:rounded-[var(--radius-sheet)] sm:shadow-[var(--shadow-float)]',
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
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
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
