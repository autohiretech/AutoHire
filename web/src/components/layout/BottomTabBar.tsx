import { NavLink } from 'react-router-dom';
import { Car, KeyRound, LayoutDashboard, MessageSquare, Search, User, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAppMode, type AppMode } from '@/lib/appMode';
import { useAuth } from '@/lib/auth';

/**
 * The mobile tab bar. Phones are how this marketplace is actually used in
 * Rwanda, and the desktop header's nav was collapsing into a hamburger there —
 * which buries the four things people came to do behind a tap.
 *
 * Four tabs, never five. A fifth stops being reachable by thumb on a narrow
 * phone and starts needing a label so short it stops being a word.
 *
 * The active tab is marked with a **filled pill behind the icon** rather than
 * just a colour change: colour alone is the one signal that fails for a
 * colour-blind user and in bright Kigali sunlight, which is exactly when this
 * app gets used. The pill carries the accent — one of the few places the
 * accent appears outside a primary button, because "where am I" is worth it.
 */
const TABS_BY_MODE: Record<AppMode, { to: string; label: string; icon: typeof Car; end?: boolean }[]> =
  {
    renter: [
      { to: '/', label: 'Explore', icon: Search, end: true },
      { to: '/trips', label: 'Trips', icon: KeyRound },
      { to: '/messages', label: 'Messages', icon: MessageSquare },
      { to: '/account', label: 'Account', icon: User },
    ],
    host: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/earnings', label: 'Earnings', icon: Wallet },
      { to: '/messages', label: 'Messages', icon: MessageSquare },
      { to: '/account', label: 'Account', icon: User },
    ],
  };

export function BottomTabBar({ unread = 0 }: { unread?: number }) {
  const { mode } = useAppMode();
  const { user } = useAuth();

  // A signed-out visitor has nothing to put in three of the four tabs, and a
  // bar of disabled stubs is worse than no bar — they browse with the header
  // and hit the sign-in gate when they reach for something that needs it.
  if (!user) return null;

  const tabs = TABS_BY_MODE[mode];

  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'border-t border-[var(--color-line)] bg-[var(--color-surface-raised)]',
        // Keeps the bar clear of the iOS home indicator / Android gesture pill.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="flex items-stretch">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-full flex-col items-center gap-1 px-1 pt-2 pb-1.5',
                  isActive
                    ? 'text-[var(--color-accent-on)]'
                    : 'text-[var(--color-content-subtle)]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative flex h-7 w-14 items-center justify-center rounded-[var(--radius-pill)] transition-colors',
                      isActive && 'bg-[var(--color-accent-on)]/12',
                    )}
                  >
                    <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                    {label === 'Messages' && unread > 0 && (
                      <span className="tabular absolute top-0 right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger-500)] px-1 text-[10px] font-bold text-white">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] leading-none font-semibold">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
