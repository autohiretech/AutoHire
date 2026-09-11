import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Car,
  ExternalLink,
  Flag,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { client } from '@/lib/client';
import { useAuth } from '@/lib/auth';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { MAIN_URL } from '@/lib/siteUrls';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui';
import { useScrollLock } from '@/components/ui/Sheet';

export type AdminSection =
  | 'overview'
  | 'users'
  | 'notifications'
  | 'verification'
  | 'activity'
  | 'moderation'
  | 'disputes';

interface NavItem {
  key: AdminSection;
  path: string;
  label: string;
  icon: LucideIcon;
  /** One line under the page title — what this section is for. */
  description: string;
}

/**
 * Every admin section, in sidebar order, grouped by the job it serves.
 *
 * Queues come first because that is the admin's day: the three places where
 * something is waiting on a decision. Reference material (people, the audit
 * trail) sits below. Flat, no nesting — at six items a second level would only
 * add clicks.
 *
 * Each section is a real URL rather than tab state, so a queue can be
 * bookmarked, shared with another admin, and survives a refresh — the admin
 * site's `_redirects` already sends every path to the app.
 */
export const ADMIN_NAV: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: null,
    items: [
      {
        key: 'overview',
        path: '/',
        label: 'Overview',
        icon: LayoutDashboard,
        description: 'Platform health, verification throughput and open work.',
      },
    ],
  },
  {
    heading: 'Queues',
    items: [
      {
        key: 'verification',
        path: '/verification',
        label: 'Verification',
        icon: ShieldCheck,
        description: 'Identity documents waiting for a decision.',
      },
      {
        key: 'disputes',
        path: '/disputes',
        label: 'Disputes',
        icon: Scale,
        description: 'Claims on bookings, decided here and settled through PayHold.',
      },
      {
        key: 'moderation',
        path: '/moderation',
        label: 'Moderation',
        icon: Flag,
        description: 'Listings and people reported by the community.',
      },
    ],
  },
  {
    heading: 'People',
    items: [
      {
        key: 'users',
        path: '/users',
        label: 'Users',
        icon: Users,
        description: 'Find any account, then message, warn, suspend or verify it.',
      },
      {
        key: 'notifications',
        path: '/notifications',
        label: 'Notifications',
        icon: Bell,
        description: 'Tell a group of people something at once, and see how many have read it.',
      },
    ],
  },
  {
    heading: 'Audit',
    items: [
      {
        key: 'activity',
        path: '/kyc-activity',
        label: 'KYC activity',
        icon: History,
        description: 'Every verification event, newest first.',
      },
    ],
  },
];

const ALL_ITEMS = ADMIN_NAV.flatMap((g) => g.items);

/** The section a path belongs to, or null for a path the admin site doesn't have. */
export function sectionForPath(pathname: string): NavItem | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ALL_ITEMS.find((i) => i.path === clean) ?? null;
}

/**
 * Work-queue counts for the sidebar. Same query keys as the sections
 * themselves, so React Query shares one fetch between a badge and its page and
 * a decision made on the page updates the badge without a second request.
 */
function useQueueCounts(): Partial<Record<AdminSection, number>> {
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => client.listFlags() });
  const disputes = useQuery({ queryKey: ['disputes'], queryFn: () => client.listDisputes() });
  const kyc = useQuery({ queryKey: ['kycMetrics'], queryFn: () => client.getKycMetrics() });
  return {
    verification: kyc.data?.pendingDocs || undefined,
    moderation: (flags.data ?? []).filter((f) => f.status === 'open').length || undefined,
    disputes:
      (disputes.data ?? []).filter((d) => d.status === 'open' || d.status === 'under_review').length ||
      undefined,
  };
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const COLLAPSE_KEY = 'autohire-admin-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The admin site's frame, in three widths:
 *  - `lg` and up: a 256px sidebar, collapsible to a 64px icon rail with the
 *    button or the `[` key, remembered per browser;
 *  - `md` to `lg`: always the icon rail — a full sidebar would take a third of
 *    a tablet screen;
 *  - below `md`: a top bar whose menu button opens the same nav as a drawer.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1024px)');
  const collapsed = collapsedPref || !wide;
  const { pathname } = useLocation();
  const counts = useQueueCounts();
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function toggleCollapsed() {
    setCollapsedPref((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* private mode — the choice just won't persist */
      }
      return !c;
    });
  }

  // `[` toggles the rail, as in Linear — ignored while typing, and below `lg`
  // where the rail isn't optional.
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      toggleCollapsed();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [wide]);

  // Choosing a section is the end of the drawer's job.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useScrollLock(drawerOpen);

  // The drawer is modal: focus moves in, Tab stays inside, Escape closes, and
  // focus returns to the menu button that opened it.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>('button, a[href]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !drawer) return;
      const focusables = [...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const opener = menuButtonRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-full md:flex">
      <aside
        className={cn(
          'sticky top-0 hidden h-svh shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          counts={counts}
          onToggleCollapsed={wide ? toggleCollapsed : undefined}
        />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)]/90 px-4 backdrop-blur md:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="admin-drawer"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-content)] hover:bg-[color-mix(in_srgb,var(--color-content)_5%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]"
        >
          <Menu size={20} />
        </button>
        <Brand />
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div
            ref={drawerRef}
            id="admin-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Admin menu"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-sheet)]"
          >
            <SidebarContent collapsed={false} counts={counts} onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
        <Car size={18} />
      </span>
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block font-display text-body font-bold text-[var(--color-content)]">AutoHire</span>
          <span className="block text-caption text-[var(--color-content-subtle)]">Admin</span>
        </span>
      )}
    </span>
  );
}

function SidebarContent({
  collapsed,
  counts,
  onToggleCollapsed,
  onClose,
}: {
  collapsed: boolean;
  counts: Partial<Record<AdminSection, number>>;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
}) {
  const { signOut } = useAuth();
  const { data: me } = useCurrentUser();

  return (
    <>
      <div className={cn('flex h-16 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <Brand collapsed={collapsed} />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-content-muted)] hover:bg-[color-mix(in_srgb,var(--color-content)_5%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {ADMIN_NAV.map((group, gi) => (
          <div key={group.heading ?? gi} className={gi > 0 ? 'mt-5' : 'mt-1'}>
            {group.heading &&
              (collapsed ? (
                <div className="mx-2 mb-2 border-t border-[var(--color-line)]" role="presentation" />
              ) : (
                <p className="mb-1.5 px-3 text-caption font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  {group.heading}
                </p>
              ))}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <SidebarLink item={item} count={counts[item.key]} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-[var(--color-line)] p-3">
        <a href={MAIN_URL} title={collapsed ? 'Open AutoHire' : undefined} className={itemClass(false, collapsed)}>
          <ExternalLink size={18} className="shrink-0" />
          <span className={collapsed ? 'sr-only' : 'truncate'}>Open AutoHire</span>
        </a>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-keyshortcuts="["
            title={collapsed ? 'Expand sidebar  [' : 'Collapse sidebar  ['}
            className={cn(itemClass(false, collapsed), 'w-full')}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} className="shrink-0" />
            ) : (
              <PanelLeftClose size={18} className="shrink-0" />
            )}
            {!collapsed && <span className="truncate">Collapse</span>}
          </button>
        )}

        {me && (
          <div className={cn('mt-2 flex items-center gap-3 pt-2', collapsed ? 'flex-col' : 'px-2')}>
            <Avatar name={me.fullName} src={me.avatarUrl} size="sm" />
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-body-sm font-medium text-[var(--color-content)]">{me.fullName}</p>
                <p className="truncate text-caption text-[var(--color-content-subtle)]">{me.email}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-content-muted)] hover:bg-[color-mix(in_srgb,var(--color-content)_5%,transparent)] hover:text-[var(--color-content)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/*
 * Item fills are a tint of the ink colour, not a surface token: `sunken` is
 * lighter than the page in the light theme but darker in the dark one, where
 * the active row read as a hole in the sidebar. A few percent of `content`
 * lifts the row in both themes.
 */
const TINT_ACTIVE = 'bg-[color-mix(in_srgb,var(--color-content)_8%,transparent)]';
const TINT_HOVER = 'hover:bg-[color-mix(in_srgb,var(--color-content)_5%,transparent)]';

function itemClass(active: boolean, collapsed: boolean) {
  return cn(
    'relative flex h-9 items-center gap-3 rounded-[var(--radius-control)] text-body-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]',
    collapsed ? 'justify-center px-0' : 'px-3',
    active
      ? cn(TINT_ACTIVE, 'font-semibold text-[var(--color-content)]')
      : cn(TINT_HOVER, 'text-[var(--color-content-muted)] hover:text-[var(--color-content)]'),
  );
}

function SidebarLink({ item, count, collapsed }: { item: NavItem; count?: number; collapsed: boolean }) {
  const Icon = item.icon;
  const shown = count && count > 99 ? '99+' : count;
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={collapsed ? (count ? `${item.label} (${shown})` : item.label) : undefined}
      className={({ isActive }) => itemClass(isActive, collapsed)}
    >
      {({ isActive }) => (
        <>
          {/* A 3px accent bar, the active marker Carbon and Linear use: it
              still reads in the icon rail, where the label is gone, and keeps
              green to one mark per row. NavLink sets aria-current="page". */}
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--color-accent-on)]"
            />
          )}
          <span className="relative shrink-0">
            <Icon size={18} className={isActive ? 'text-[var(--color-accent-on)]' : undefined} />
            {collapsed && count ? (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-[var(--color-content)] ring-2 ring-[var(--color-surface)]"
              />
            ) : null}
          </span>
          <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
          {count ? (
            collapsed ? (
              <span className="sr-only">, {count} waiting</span>
            ) : (
              <span
                className={cn(
                  'tabular rounded-[var(--radius-pill)] px-1.5 text-caption font-semibold',
                  isActive
                    ? 'bg-[var(--color-surface)] text-[var(--color-content)]'
                    : cn(TINT_ACTIVE, 'text-[var(--color-content-muted)]'),
                )}
              >
                {shown}
                <span className="sr-only"> waiting</span>
              </span>
            )
          ) : null}
        </>
      )}
    </NavLink>
  );
}
