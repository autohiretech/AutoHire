import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useRealtime } from '@/lib/useRealtime';
import { Header } from './Header';
import { Footer } from './Footer';
import { RightRail } from './RightRail';
import { BottomTabBar } from './BottomTabBar';
import { NotificationsProvider } from '@/components/NotificationsProvider';
import { LocationPrompt } from '@/components/marketplace/LocationPrompt';
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt';
import { ScrollMemory } from '@/components/ScrollMemory';
import { AiAssistantProvider } from '@/lib/aiAssistantContext';

export function AppLayout() {
  const { pathname } = useLocation();

  // Tracks the path being left, not just the one arrived at — useBackToBrowse
  // reads this to tell whether history.back() would land somewhere that's
  // actually a "browse" page, since a route the renter reached from a
  // non-browse page (the assistant jumping straight to a car from anywhere,
  // e.g.) shouldn't send "Back to browse" to wherever that happened to be.
  useEffect(() => {
    const current = sessionStorage.getItem('autohire-current-path');
    sessionStorage.setItem('autohire-prev-path', current ?? '');
    sessionStorage.setItem('autohire-current-path', pathname);
  }, [pathname]);

  // Live messages / unread badges / notifications (no-op until signed in).
  useRealtime();

  // No session gate here: guests can browse the shell (home, car listings) and
  // only get sent to /login when they hit an account-only route (RequireAuth /
  // RequireRole gate those individually).

  // Messaging and search are full-bleed app screens: fill the viewport, no footer.
  // Search needs this so its map can occupy the full remaining height instead of
  // being one section in a long scrolling page.
  // /ai is the agent's own room — a map with a field docked over it — and
  // needs the same full-height treatment as search for the same reason.
  const fullBleed =
    pathname === '/messages' ||
    pathname.startsWith('/messages/') ||
    pathname === '/search' ||
    pathname === '/ai';

  return (
    <NotificationsProvider>
      {/* Wraps the whole shell, not just the assistant, so any page under
          <Outlet> can publish its current listings via useAiAssistantSource
          — a car's own detail page included, not just /search. */}
      <AiAssistantProvider>
        <div className={cn('flex flex-col', fullBleed ? 'h-full overflow-hidden' : 'min-h-full')}>
          <ScrollMemory />
          {/* Portal-rendered (see Modal), so its place in this tree is just
              "mounted once per app," not tied to fullBleed or page layout. */}
          <PwaInstallPrompt />
          {/* Eco commitment banner — AutoHire's fleet is overwhelmingly clean-energy.
              This used to be a full-width solid brand-green bar above the
              header, which put the accent at the very top of every screen
              before the page had said anything. It is a standing fact, not an
              action, so it now reads as one: quiet type on the page surface,
              with the accent carried only by the leaf. */}
          <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)]">
            <p className="mx-auto flex max-w-[1500px] items-center justify-center gap-2 px-4 py-1.5 text-center text-caption text-[var(--color-content-muted)]">
              <Leaf size={13} className="shrink-0 text-[var(--color-accent-on)]" />
              <span>
                <span className="font-semibold text-[var(--color-content)]">
                  90% Electric, Hybrid &amp; Ecological.
                </span>{' '}
                On the road to 100% environmentally friendly by 2030.
              </span>
            </p>
          </div>
          <Header />
          {!fullBleed && <LocationPrompt />}
          {/* The tab bar is fixed and exists for every visitor on a phone —
              guests included, since BottomTabBar stopped returning null for
              them — so content always reserves that much room below `md`: a
              scrolling page pads its bottom so the last row clears the bar,
              and a full-bleed screen (search, messages) shortens itself so
              its own bottom edge — the results sheet, the composer — sits
              above the bar rather than behind it. */}
          <main
            className={cn(
              'flex-1 pb-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))] md:pb-0',
              fullBleed && 'min-h-0 overflow-hidden',
            )}
          >
            <Outlet />
          </main>
          {!fullBleed && <Footer />}
          <BottomTabBar />
          <RightRail />
        </div>
      </AiAssistantProvider>
    </NotificationsProvider>
  );
}
