import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Car, LogOut, Menu, MessageSquare, Rss, ShieldCheck, Star, Users, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar, Button } from '@/components/ui';
import { useNotifications } from '@/components/NotificationsProvider';
import { CountrySelector } from '@/components/marketplace/CountrySelector';
import { CurrencySelector } from '@/components/marketplace/CurrencySelector';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCanRent } from '@/lib/account';
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
    { to: '/earnings', label: 'Earnings' },
    { to: '/', label: 'Explore', end: true },
    { to: '/verification', label: 'Verification' },
  ],
};

export function Header() {
  const { mode } = useAppMode();
  const { user, signOut } = useAuth();
  const { data: me } = useCurrentUser();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { open: openNotifications } = useNotifications();
  const canRent = useCanRent();

  // Close the mobile menu whenever the route changes.
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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

  const { data: host } = useQuery({
    queryKey: ['ownerHost'],
    queryFn: () => client.getCurrentHost(),
    enabled: mode === 'host',
  });

  // Guests get no nav links — the logo already goes home, so "Explore" is
  // redundant, and account actions are gated. They sign in / sign up when ready.
  const navItems: { to: string; label: string; end?: boolean }[] = user
    ? NAV_BY_MODE[mode]
    : [];
  const identityName =
    mode === 'host' ? host?.businessName ?? host?.fullName ?? 'Host' : me?.fullName ?? 'You';

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 px-4">
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
          <CountrySelector />
          <CurrencySelector />
          {user ? (
            <>
              {me?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="rounded-lg p-2 text-ink-500 hover:bg-ink-100"
                  aria-label="Admin panel"
                >
                  <ShieldCheck size={20} />
                </Link>
              )}
              {/* Watching is a renter's tool — hosts and companies can't book,
                  so "tell me when this is free" means nothing to them. */}
              {canRent && (
                <Link
                  to="/watchlist"
                  className="hidden rounded-lg p-2 text-ink-500 hover:bg-ink-100 sm:block"
                  aria-label="Cars you're watching"
                  title="Watching"
                >
                  <Star size={20} />
                </Link>
              )}
              <Link
                to="/feed"
                className="hidden rounded-lg p-2 text-ink-500 hover:bg-ink-100 sm:block"
                aria-label="Feed"
                title="Feed"
              >
                <Rss size={20} />
              </Link>
              {/* Circles are role-agnostic — a host and a renter both use them. */}
              <Link
                to="/circles"
                className="hidden rounded-lg p-2 text-ink-500 hover:bg-ink-100 sm:block"
                aria-label="Your circles"
                title="Circles"
              >
                <Users size={20} />
              </Link>
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
              <button
                type="button"
                onClick={openNotifications}
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
              </button>
              <Link to="/account" aria-label="Account" className="ml-1">
                <Avatar name={identityName} src={mode === 'host' ? host?.avatarUrl : me?.avatarUrl} size="sm" />
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                className="ml-1 hidden rounded-lg p-2 text-ink-500 hover:bg-ink-100 md:block"
                aria-label="Sign out"
                title={user.email ?? 'Sign out'}
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <Link to="/login">
                <Button size="sm" variant="outline">
                  Sign in
                </Button>
              </Link>
              <Link to="/login" state={{ from: pathname }}>
                <Button size="sm">Sign up</Button>
              </Link>
            </div>
          )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-1 rounded-lg p-2 text-ink-500 hover:bg-ink-100 md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile nav panel */}
      {menuOpen && (
        <nav id="mobile-nav" className="border-t border-ink-200 bg-white px-4 py-2 md:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={closeMenu}
              className={({ isActive }) =>
                cn(
                  'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          {canRent && (
            <NavLink
              to="/watchlist"
              onClick={closeMenu}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100',
                )
              }
            >
              <Star size={16} /> Watching
            </NavLink>
          )}
          {user && (
            <NavLink
              to="/feed"
              onClick={closeMenu}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100',
                )
              }
            >
              <Rss size={16} /> Feed
            </NavLink>
          )}
          {user && (
            <NavLink
              to="/circles"
              onClick={closeMenu}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100',
                )
              }
            >
              <Users size={16} /> Circles
            </NavLink>
          )}
          {user && (
            <button
              type="button"
              onClick={() => {
                closeMenu();
                openNotifications();
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100"
            >
              <span className="flex items-center gap-2">
                <Bell size={16} /> Notifications
              </span>
              {unreadNotifications > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">
                  {unreadNotifications}
                </span>
              )}
            </button>
          )}
          <div className="my-2 border-t border-ink-100" />
          {user ? (
            <button
              type="button"
              onClick={() => {
                closeMenu();
                signOut();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              <LogOut size={16} /> Sign out
            </button>
          ) : (
            <div className="flex flex-col gap-2 px-1 py-1">
              <Link to="/login" onClick={closeMenu}>
                <Button variant="outline" className="w-full">
                  Sign in
                </Button>
              </Link>
              <Link to="/login" state={{ from: pathname }} onClick={closeMenu}>
                <Button className="w-full">Sign up</Button>
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
