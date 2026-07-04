import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CarFront, LayoutDashboard, MessageSquare, PlusCircle, type LucideIcon } from 'lucide-react';
import { client } from '@/lib/client';
import { useAppMode } from '@/lib/appMode';
import { useAuth } from '@/lib/auth';

type RailItem = { to: string; label: string; icon: LucideIcon; badge?: number };

/**
 * Fixed right-edge shortcut rail (Alibaba-style), shown app-wide from 1660px up
 * where the page margin has room for it. Items follow the account: renters get
 * "Trips", hosts get "Dashboard" + "List car" (renters become a host first).
 * Messages/Alerts carry live unread counts from the same queries as the header.
 */
export function RightRail() {
  const { mode } = useAppMode();
  const { user } = useAuth();

  const { data: unread = 0 } = useQuery({
    queryKey: ['unreadMessages'],
    queryFn: () => client.getUnreadMessageCount(),
    enabled: !!user,
  });
  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => client.listNotifications(),
    enabled: !!user,
  });
  const unreadNotifications = (notifications ?? []).filter((n) => !n.read).length;

  // The rail is all account shortcuts (Messages, Alerts, Trips) — hide it from
  // guests, who browse via the header and page content instead.
  if (!user) return null;

  const items: RailItem[] = [
    { to: '/messages', label: 'Messages', icon: MessageSquare, badge: unread },
    { to: '/notifications', label: 'Alerts', icon: Bell, badge: unreadNotifications },
    ...(mode === 'host'
      ? ([
          { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { to: '/cars/new', label: 'List car', icon: PlusCircle },
        ] as RailItem[])
      : ([{ to: '/trips', label: 'Trips', icon: CarFront }] as RailItem[])),
  ];

  return (
    <div className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1 rounded-2xl border border-ink-100 bg-white/95 p-1.5 shadow-lg backdrop-blur min-[1660px]:flex">
      {items.map(({ to, label, icon: Icon, badge }) => (
        <Link
          key={to}
          to={to}
          className="flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          <span className="relative">
            <Icon size={20} />
            {badge && badge > 0 ? (
              <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </span>
          {label}
        </Link>
      ))}
    </div>
  );
}
