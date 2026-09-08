import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; message: string };

/**
 * Tiny module-level pub/sub so `toast.success(...)` works from anywhere
 * (mutations, event handlers) without threading a context through props.
 * A single <Toaster /> mounted at the app root renders the queue.
 */
let listeners: ((t: ToastItem) => void)[] = [];
let counter = 0;

function emit(kind: ToastKind, message: string) {
  const item: ToastItem = { id: ++counter, kind, message };
  listeners.forEach((l) => l(item));
}

export const toast = {
  success: (message: string) => emit('success', message),
  error: (message: string) => emit('error', message),
  info: (message: string) => emit('info', message),
};

// Tone mapping: success -> brand tint (positive and brand share a hue here),
// error -> danger, info -> info. Each pairs a `-tint` background with the
// matching `-500` text/icon colour — never the accent, which stays reserved
// for actionable controls elsewhere on screen.
const META: Record<ToastKind, { icon: typeof Info; bg: string; text: string }> = {
  success: { icon: CheckCircle2, bg: 'bg-brand-50 dark:bg-brand-900/30', text: 'text-brand-700 dark:text-brand-300' },
  error: { icon: AlertCircle, bg: 'bg-[var(--color-danger-tint)]', text: 'text-[var(--color-danger-500)]' },
  info: { icon: Info, bg: 'bg-[var(--color-info-tint)]', text: 'text-[var(--color-info-500)]' },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const dismiss = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));
    const listener = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => dismiss(t.id), 4000);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (items.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {items.map((t) => {
        const meta = META[t.kind];
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'animate-popover-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[var(--radius-sheet)] px-3.5 py-3 shadow-[var(--shadow-float)]',
              meta.bg,
            )}
          >
            <Icon size={18} className={cn('mt-0.5 shrink-0', meta.text)} />
            <p className={cn('flex-1 text-body-sm', meta.text)}>{t.message}</p>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className={cn('shrink-0 rounded-[var(--radius-control)] p-0.5 opacity-70 hover:opacity-100', meta.text)}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
