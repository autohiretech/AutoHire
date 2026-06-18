import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Bell,
  CheckCircle2,
  Clock,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import type { AppNotification, NotificationChannel, NotificationKind } from '@autohire/shared';
import { mockClient } from '@/mocks/client';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { Badge, Button, Card, CardBody, Spinner } from '@/components/ui';

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  booking_confirmation: <CheckCircle2 size={18} />,
  pickup_reminder: <Clock size={18} />,
  return_reminder: <Clock size={18} />,
  payout_alert: <Banknote size={18} />,
  message: <MessageSquare size={18} />,
  verification: <ShieldCheck size={18} />,
};

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  sms: 'SMS',
  push: 'Push',
  in_app: 'In-app',
};

export function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => mockClient.listNotifications(),
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => mockClient.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAllMutation = useMutation({
    mutationFn: () => mockClient.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = (notifications ?? []).filter((n) => !n.read).length;

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-900">Notifications</h1>
        {unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => readAllMutation.mutate()}
            disabled={readAllMutation.isPending}
          >
            Mark all as read
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : notifications && notifications.length > 0 ? (
        <div className="space-y-3">
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onRead={() => !n.read && readMutation.mutate(n.id)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Bell size={32} className="text-ink-300" />
            <p className="text-sm text-ink-500">You're all caught up.</p>
          </CardBody>
        </Card>
      )}
    </section>
  );
}

function NotificationRow({
  notification: n,
  onRead,
}: {
  notification: AppNotification;
  onRead: () => void;
}) {
  return (
    <button type="button" onClick={onRead} className="block w-full text-left">
      <Card
        className={cn(
          'transition-shadow hover:shadow-md',
          !n.read && 'border-brand-200 bg-brand-50/40',
        )}
      >
        <CardBody className="flex gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              n.read ? 'bg-ink-100 text-ink-500' : 'bg-brand-100 text-brand-700',
            )}
          >
            {KIND_ICON[n.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className={cn('truncate', n.read ? 'font-medium text-ink-800' : 'font-semibold text-ink-900')}>
                {n.title}
              </p>
              <span className="flex shrink-0 items-center gap-2">
                {!n.read && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
                <span className="text-xs text-ink-400">{timeAgo(n.createdAt)}</span>
              </span>
            </div>
            <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {n.channels.map((c) => (
                <Badge key={c} tone="neutral">
                  {CHANNEL_LABEL[c]}
                </Badge>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </button>
  );
}
