import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  Bell,
  CheckCircle2,
  ChevronLeft,
  Clock,
  MessageSquare,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import type { AppNotification, NotificationChannel, NotificationKind } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatDate, timeAgo } from '@/lib/format';
import { useAppMode } from '@/lib/appMode';
import { Badge, Button, Spinner } from '@/components/ui';

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  booking_confirmation: <CheckCircle2 size={18} />,
  pickup_reminder: <Clock size={18} />,
  return_reminder: <Clock size={18} />,
  payout_alert: <Banknote size={18} />,
  message: <MessageSquare size={18} />,
  verification: <ShieldCheck size={18} />,
  watchlist: <Star size={18} />,
};

const KIND_LABEL: Record<NotificationKind, string> = {
  booking_confirmation: 'Booking',
  pickup_reminder: 'Pickup reminder',
  return_reminder: 'Return reminder',
  payout_alert: 'Payout',
  message: 'Message',
  verification: 'Verification',
  watchlist: 'Watchlist',
};

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  sms: 'SMS',
  push: 'Push',
  in_app: 'In-app',
};

/**
 * Where a notification's "Open" action should take the reader. A notification
 * about one specific thing carries its own `link` (a watched car, say); the rest
 * route by kind.
 */
function actionFor(n: AppNotification, isHost: boolean): { to: string; label: string } | null {
  if (n.link) {
    return { to: n.link, label: n.kind === 'watchlist' ? 'View the car' : 'Open' };
  }
  switch (n.kind) {
    case 'message':
      return { to: '/messages', label: 'Open messages' };
    case 'verification':
      return { to: '/verification', label: 'Go to verification' };
    case 'payout_alert':
      return isHost ? { to: '/dashboard', label: 'View payouts' } : null;
    case 'booking_confirmation':
    case 'pickup_reminder':
    case 'return_reminder':
      return isHost ? { to: '/dashboard', label: 'Open dashboard' } : { to: '/trips', label: 'View trip' };
    default:
      return null;
  }
}

/**
 * Notification center as a modal (list ⇄ detail), opened from the header bell.
 * The list shows every notification; tapping one marks it read and opens a
 * detail view with the full message and a context-aware action.
 */
export function NotificationsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mode } = useAppMode();
  const isHost = mode === 'host';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // While open: Escape closes, background scroll is locked, and focus moves into
  // the drawer for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedId(null);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => client.listNotifications(),
    enabled: open,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => client.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAllMutation = useMutation({
    mutationFn: () => client.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!open) return null;

  const list = notifications ?? [];
  const unread = list.filter((n) => !n.read).length;
  const selected = list.find((n) => n.id === selectedId) ?? null;

  // Close resets to the list so it doesn't reopen mid-detail next time.
  const close = () => {
    setSelectedId(null);
    onClose();
  };

  const go = (to: string) => {
    close();
    navigate(to);
  };

  // A tap should land you on the thing itself — the booking, the watched car —
  // not a summary screen with one more button to press. Only notifications with
  // nowhere specific to go (a plain verification nudge, say) fall back to the
  // in-modal detail view, since there's nothing else to show them.
  const openNotification = (n: AppNotification) => {
    if (!n.read) readMutation.mutate(n.id);
    const action = actionFor(n, isHost);
    if (action) go(action.to);
    else setSelectedId(n.id);
  };

  const action = selected ? actionFor(selected, isHost) : null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="animate-overlay-in absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
        className="animate-drawer-in absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)] outline-none sm:rounded-l-[var(--radius-sheet)]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          {selected ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="-ml-1 rounded-[var(--radius-control)] p-1 text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
              aria-label="Back to notifications"
            >
              <ChevronLeft size={18} />
            </button>
          ) : (
            <Bell size={18} className="text-[var(--color-accent-on)]" />
          )}
          <h2 className="flex-1 text-h4 text-[var(--color-content)]">
            {selected ? KIND_LABEL[selected.kind] : 'Notifications'}
          </h2>
          {!selected && unread > 0 && (
            <button
              type="button"
              onClick={() => readAllMutation.mutate()}
              disabled={readAllMutation.isPending}
              className="text-caption font-medium text-[var(--color-accent-on)] hover:underline disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={close}
            className="rounded-[var(--radius-control)] p-1 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <NotificationDetail notification={selected} action={action} onAction={go} />
          ) : isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : list.length > 0 ? (
            <ul className="divide-y divide-[var(--color-line)]">
              {list.map((n) => (
                <NotificationRow key={n.id} notification={n} onOpen={() => openNotification(n)} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Bell size={32} className="text-[var(--color-content-subtle)]" />
              <p className="text-body-sm text-[var(--color-content-muted)]">You're all caught up.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact list row: icon, title, preview, unread dot + time. */
function NotificationRow({ notification: n, onOpen }: { notification: AppNotification; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-sunken)]',
          !n.read && 'bg-brand-50/40 dark:bg-brand-900/10',
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
            n.read
              ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]'
              : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
          )}
        >
          {KIND_ICON[n.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                'truncate text-body-sm',
                n.read ? 'font-medium text-[var(--color-content-muted)]' : 'font-semibold text-[var(--color-content)]',
              )}
            >
              {n.title}
            </p>
            <span className="flex shrink-0 items-center gap-2">
              {!n.read && <span className="h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--color-accent-on)]" aria-label="Unread" />}
              <span className="text-caption text-[var(--color-content-subtle)]">{timeAgo(n.createdAt)}</span>
            </span>
          </div>
          <p className="mt-0.5 truncate text-body-sm text-[var(--color-content-muted)]">{n.body}</p>
        </div>
        <ChevronLeft size={16} className="mt-2.5 shrink-0 rotate-180 text-[var(--color-content-subtle)]" />
      </button>
    </li>
  );
}

/** Expanded view for one notification: full body, meta, and a context action. */
function NotificationDetail({
  notification: n,
  action,
  onAction,
}: {
  notification: AppNotification;
  action: { to: string; label: string } | null;
  onAction: (to: string) => void;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          {KIND_ICON[n.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[var(--color-content)]">{n.title}</p>
          <p className="mt-0.5 text-caption text-[var(--color-content-subtle)]">
            {formatDate(n.createdAt)} · {timeAgo(n.createdAt)}
          </p>
        </div>
      </div>

      <p className="mt-4 whitespace-pre-line text-body-sm leading-relaxed text-[var(--color-content-muted)]">{n.body}</p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-[var(--color-content-subtle)]">Sent via</span>
        {n.channels.map((c) => (
          <Badge key={c} tone="neutral">
            {CHANNEL_LABEL[c]}
          </Badge>
        ))}
      </div>

      {action && (
        <Button className="mt-5 w-full" onClick={() => onAction(action.to)}>
          {action.label} <ArrowRight size={16} />
        </Button>
      )}
    </div>
  );
}
