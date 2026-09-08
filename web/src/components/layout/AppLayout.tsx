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
import { ScrollMemory } from '@/components/ScrollMemory';
import { AiAssistantProvider } from '@/lib/aiAssistantContext';
import { AiAssistant } from '@/components/assistant/AiAssistant';

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
  const fullBleed =
    pathname === '/messages' || pathname.startsWith('/messages/') || pathname === '/search';

  // The assistant's whole toolset (book, message a host, watchlist a car) is
  // a renter's own actions on a listing — meaningless on a host's own
  // /dashboard, where the signed-in account is managing its cars, not
  // renting one. The home page has its own "AI mode" entry point as the sole
  // entry point there — the floating bubble would just be a second, redundant
  // one on the one page that already has a dedicated way in. Every other
  // page keeps the floating assistant.
  const hideAssistant = pathname === '/dashboard' || pathname === '/';

  return (
    <NotificationsProvider>
      {/* Wraps the whole shell, not just the assistant, so any page under
          <Outlet> can publish its current listings via useAiAssistantSource
          — a car's own detail page included, not just /search. */}
      <AiAssistantProvider>
        <div className={cn('flex flex-col', fullBleed ? 'h-full overflow-hidden' : 'min-h-full')}>
          <ScrollMemory />
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
          {/* The tab bar is fixed, so scrolling content needs padding to clear
              it or the last row of every list sits under the bar. Full-bleed
              screens (search, messages) manage their own height and place the
              bar themselves. */}
          <main
            className={cn(
              'flex-1',
              fullBleed ? 'min-h-0 overflow-hidden' : 'pb-[68px] md:pb-0',
            )}
          >
            <Outlet />
          </main>
          {!fullBleed && <Footer />}
          <BottomTabBar />
          <RightRail />
          {/* Mounted once here, not per-page — this is what makes the
              assistant (and its conversation) survive navigating between
              pages instead of resetting on every route. Hidden on
              /dashboard and / (see hideAssistant above). */}
          {!hideAssistant && <AiAssistant />}
        </div>
      </AiAssistantProvider>
    </NotificationsProvider>
  );
}
