import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Car,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Search,
  Sparkles,
  User,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { client } from '@/lib/client';
import { useAppMode, type AppMode } from '@/lib/appMode';
import { useAuth } from '@/lib/auth';

/**
 * The mobile tab bar. Phones are how this marketplace is actually used in
 * Rwanda, and the desktop header's nav was collapsing into a hamburger there —
 * which buries the things people came to do behind a tap.
 *
 * Five tabs, with the AI in the middle. The middle slot is the one a thumb
 * reaches without adjusting the grip, and "say what you want" is the action
 * the product is being built around — so it gets the slot rather than a
 * corner. The labels stay whole words; at five the bar is at its limit, and
 * a sixth would need abbreviations, which is the point to stop.
 *
 * The active tab is marked with a **filled pill behind the icon** rather than
 * just a colour change: colour alone is the one signal that fails for a
 * colour-blind user and in bright Kigali sunlight, which is exactly when this
 * app gets used. The pill carries the accent — one of the few places the
 * accent appears outside a primary button, because "where am I" is worth it.
 *
 * The AI tab carries the page the user was on into /ai (`state.from`), so an
 * ask made from a car page already knows which car "this one" is.
 */
const AI_TAB = { to: '/ai', label: 'AI', icon: Sparkles } as const;

const TABS_BY_MODE: Record<AppMode, { to: string; label: string; icon: typeof Car; end?: boolean }[]> =
  {
    renter: [
      { to: '/', label: 'Explore', icon: Search, end: true },
      { to: '/trips', label: 'Trips', icon: KeyRound },
      AI_TAB,
      { to: '/messages', label: 'Messages', icon: MessageSquare },
      { to: '/account', label: 'Account', icon: User },
    ],
    host: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/earnings', label: 'Earnings', icon: Wallet },
      AI_TAB,
      { to: '/messages', label: 'Messages', icon: MessageSquare },
      { to: '/account', label: 'Account', icon: User },
    ],
  };

export function BottomTabBar() {
  const { mode } = useAppMode();
  const { user } = useAuth();
  const { pathname } = useLocation();

  // Same query Header's desktop nav reads (shared cache key, so this doesn't
  // double the request) — the bar needs its own copy because it renders
  // independently of Header's Messages icon, which is desktop-only now.
  const { data: unread = 0 } = useQuery({
    queryKey: ['unreadMessages'],
    queryFn: () => client.getUnreadMessageCount(),
    enabled: !!user,
  });

  // Guests get the bar too. It used to return null for them, on the reasoning
  // that most tabs would be dead stubs — but they aren't stubs: RequireAuth
  // sends a guest to /login remembering where they were headed, and bounces
  // them back after they sign in, which is how a marketplace is expected to
  // behave. Returning null meant a signed-out visitor on a phone had no
  // navigation at the bottom of the screen at all.
  //
  // Two differences for a guest: the tabs are always the renter set (there is
  // no host to be yet), and the last one says what it actually does — "Sign
  // in", going straight to /login rather than calling itself Account when
  // there is no account behind it.
  const tabs = user
    ? TABS_BY_MODE[mode]
    : [
        ...TABS_BY_MODE.renter.slice(0, -1),
        { to: '/login', label: 'Sign in', icon: User },
      ];

  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'border-t border-[var(--color-line)] bg-[var(--color-surface-raised)]',
        // Content sizes itself to `--tab-bar-height` (58px) from its own
        // padding — not set explicitly here, so the safe-area padding below
        // adds to that instead of squeezing it under a fixed box height.
        // `AppLayout` reserves the same 58px plus this same inset.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="flex items-stretch">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              state={to === AI_TAB.to ? { from: pathname } : undefined}
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
