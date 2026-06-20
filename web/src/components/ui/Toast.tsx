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

const META: Record<ToastKind, { icon: typeof Info; ring: string; text: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200', text: 'text-emerald-600' },
  error: { icon: AlertCircle, ring: 'border-red-200', text: 'text-red-600' },
  info: { icon: Info, ring: 'border-ink-200', text: 'text-ink-500' },
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
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {items.map((t) => {
        const meta = META[t.kind];
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-white px-3.5 py-3 shadow-lg',
              meta.ring,
            )}
          >
            <Icon size={18} className={cn('mt-0.5 shrink-0', meta.text)} />
            <p className="flex-1 text-sm text-ink-800">{t.message}</p>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded-md p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
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
