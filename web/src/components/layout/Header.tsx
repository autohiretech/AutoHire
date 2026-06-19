import { Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Car, LogOut, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar, Button } from '@/components/ui';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { MODE_HOME, useAppMode, type AppMode } from '@/lib/appMode';
import { useAuth } from '@/lib/auth';

// Nav follows the account (set by useAppMode) — no manual mode toggle. Host
// accounts manage listings and can browse the market to analyze it (Explore),
// but get no renter actions (no "My trips", and booking is disabled). A personal
// host switches back to renting from their profile. Renters get a "List your
// car" entry to start hosting.
const NAV_BY_MODE: Record<AppMode, { to: string; label: string; end?: boolean }[]> = {
  renter: [
    { to: '/', label: 'Explore', end: true },
    { to: '/trips', label: 'My trips' },
    // Renters can't list cars directly — they become a host first.
    { to: '/account', label: 'Become a host' },
  ],
  host: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/', label: 'Explore', end: true },
    { to: '/verification', label: 'Verification' },
  ],
};

export function Header() {
  const { mode } = useAppMode();
  const { user, signOut } = useAuth();
  const { data: me } = useCurrentUser();

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => client.listConversations(),
  });
  const unread = (conversations ?? []).reduce((sum, c) => sum + c.unread, 0);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => client.listNotifications(),
  });
  const unreadNotifications = (notifications ?? []).filter((n) => !n.read).length;

  const { data: host } = useQuery({
    queryKey: ['ownerHost'],
    queryFn: () => client.getCurrentHost(),
    enabled: mode === 'host',
  });

  const navItems = NAV_BY_MODE[mode];
  const identityName =
    mode === 'host' ? host?.businessName ?? host?.fullName ?? 'Host' : me?.fullName ?? 'You';

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link to={MODE_HOME[mode]} className="flex items-center gap-2 font-bold text-brand-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Car size={18} />
          </span>
          <span className="text-lg">AutoHire</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/messages"
            className="relative rounded-lg p-2 text-ink-500 hover:bg-ink-100"
            aria-label={unread > 0 ? `Messages (${unread} unread)` : 'Messages'}
          >
            <MessageSquare size={20} />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                {unread}
              </span>
            )}
          </Link>
          <Link
            to="/notifications"
            className="relative hidden rounded-lg p-2 text-ink-500 hover:bg-ink-100 sm:block"
            aria-label={
              unreadNotifications > 0
                ? `Notifications (${unreadNotifications} unread)`
                : 'Notifications'
            }
          >
            <Bell size={20} />
            {unreadNotifications > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                {unreadNotifications}
              </span>
            )}
          </Link>
          <Link to="/account" aria-label="Account" className="ml-1">
            <Avatar name={identityName} src={mode === 'host' ? host?.avatarUrl : me?.avatarUrl} size="sm" />
          </Link>

          {user ? (
            <button
              type="button"
              onClick={() => signOut()}
              className="ml-1 rounded-lg p-2 text-ink-500 hover:bg-ink-100"
              aria-label="Sign out"
              title={user.email ?? 'Sign out'}
            >
              <LogOut size={18} />
            </button>
          ) : (
            <Link to="/login" className="ml-1">
              <Button size="sm" variant="outline">
                Sign in
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
