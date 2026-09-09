import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Car,
  LogOut,
  Menu,
  MessageSquare,
  Rss,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar, Button } from '@/components/ui';
import { useNotifications } from '@/components/NotificationsProvider';
import { CountrySelector } from '@/components/marketplace/CountrySelector';
import { CurrencySelector } from '@/components/marketplace/CurrencySelector';
import { LanguageSelector } from '@/components/marketplace/LanguageSelector';
import { LANGUAGES, useLanguage } from '@/lib/i18n';
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
  const { lang, setLang, t } = useLanguage();
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
    <header className="sticky top-0 z-[45] border-b border-[var(--color-line)] bg-[var(--color-surface)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 px-4">
        {/* The wordmark is ink, not green. A green logo plus a green nav pill
            plus a green CTA put the accent on screen three times before the
            page began; the mark earns its colour from the glyph instead. */}
        <Link
          to={MODE_HOME[mode]}
          className="flex items-center gap-2 font-display text-body-lg font-extrabold text-[var(--color-content)]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
            <Car size={18} />
          </span>
          <span>AutoHire</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-[var(--radius-control)] px-3 py-2 text-body-sm font-semibold whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]'
                    : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* `min-w-0` so this group can actually shrink. The three selectors
            each carry `min-w-0 shrink` themselves, but a flex item cannot
            compress below its content unless its parent can too — without
            this the group stayed at its natural width and pushed the header
            ~6px past the viewport at ~830px, taking the hamburger with it. */}
        <div className="flex min-w-0 items-center gap-2">
          <CountrySelector />
          <CurrencySelector />
          {/* Third selector only once there is room. At 390px the row is
              logo + country + currency + language + hamburger, and the
              hamburger was being pushed 18px off the right edge — unclickable.
              Language is a set-once preference, so below `sm` it moves into
              the menu rather than competing for the last 18px. */}
          <div className="hidden sm:block">
            <LanguageSelector />
          </div>
          {user ? (
            <>
              {/* Desktop entry to the agent's own room. On phones the middle
                  tab is the entry, so this stays hidden there. Carries the
                  current page along so "book this one" from a car page means
                  that car. Outline, not primary: the page's own action keeps
                  the accent. */}
              <Link
                to="/ai"
                state={{ from: pathname }}
                className="hidden shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] px-3 py-1.5 text-body-sm font-semibold whitespace-nowrap text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)] lg:inline-flex"
              >
                <Sparkles size={15} className="text-[var(--color-accent-on)]" /> Ask AI
              </Link>
              {me?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)]"
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
                  className="hidden rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] lg:block"
                  aria-label="Cars you're watching"
                  title="Watching"
                >
                  <Star size={20} />
                </Link>
              )}
              <Link
                to="/feed"
                className="hidden rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] lg:block"
                aria-label="Feed"
                title="Feed"
              >
                <Rss size={20} />
              </Link>
              {/* Circles are role-agnostic — a host and a renter both use them. */}
              <Link
                to="/circles"
                className="hidden rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] lg:block"
                aria-label="Your circles"
                title="Circles"
              >
                <Users size={20} />
              </Link>
              <Link
                to="/messages"
                className="relative hidden rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] md:block"
                aria-label={unread > 0 ? `Messages (${unread} unread)` : 'Messages'}
              >
                <MessageSquare size={20} />
                {unread > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger-500)] px-1 text-[10px] font-bold text-white">
                    {unread}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={openNotifications}
                className="relative hidden rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] sm:block"
                aria-label={
                  unreadNotifications > 0
                    ? `Notifications (${unreadNotifications} unread)`
                    : 'Notifications'
                }
              >
                <Bell size={20} />
                {unreadNotifications > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger-500)] px-1 text-[10px] font-bold text-white">
                    {unreadNotifications}
                  </span>
                )}
              </button>
              <Link to="/account" aria-label="Account" className="ml-1 hidden md:block">
                <Avatar name={identityName} src={mode === 'host' ? host?.avatarUrl : me?.avatarUrl} size="sm" />
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                className="ml-1 hidden rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] md:block"
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
            className="ml-1 rounded-[var(--radius-control)] p-2 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] lg:hidden"
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
        <nav id="mobile-nav" className="border-t border-[var(--color-line)] bg-[var(--color-surface-raised)] px-4 py-2 lg:hidden">
          {/* Language lives here on the narrowest screens, where the
              header has no room for a third selector. `sm:hidden`
              rather than always-on so it is not offered twice. */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] pb-2 sm:hidden">
            <span className="text-body-sm font-semibold text-[var(--color-content-muted)]">{t('lang.label')}</span>
            <div className="flex items-center gap-1">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setLang(l.code)}
                  aria-pressed={lang === l.code}
                  className={cn(
                    'rounded-[var(--radius-pill)] px-3 py-1.5 text-body-sm font-semibold transition-colors',
                    lang === l.code
                      ? 'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
                      : 'text-[var(--color-content-muted)]',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={closeMenu}
              className={({ isActive }) =>
                cn(
                  'block rounded-[var(--radius-control)] px-3 py-2.5 text-body-sm font-semibold transition-colors',
                  isActive ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]' : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
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
                  'flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-body-sm font-semibold transition-colors',
                  isActive ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]' : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
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
                  'flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-body-sm font-semibold transition-colors',
                  isActive ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]' : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
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
                  'flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-body-sm font-semibold transition-colors',
                  isActive ? 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]' : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
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
              className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2.5 text-body-sm font-semibold text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              <span className="flex items-center gap-2">
                <Bell size={16} /> Notifications
              </span>
              {unreadNotifications > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-danger-500)] px-1.5 text-[11px] font-bold text-white">
                  {unreadNotifications}
                </span>
              )}
            </button>
          )}
          <div className="my-2 border-t border-[var(--color-line)]" />
          {user ? (
            <button
              type="button"
              onClick={() => {
                closeMenu();
                signOut();
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-body-sm font-semibold text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]"
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
