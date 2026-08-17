import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useRealtime } from '@/lib/useRealtime';
import { Header } from './Header';
import { Footer } from './Footer';
import { RightRail } from './RightRail';
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
          {/* Eco commitment banner — AutoHire's fleet is overwhelmingly clean-energy. */}
          <div className="bg-brand-700 text-white">
            <p className="mx-auto flex max-w-[1500px] items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium sm:text-[13px]">
              <Leaf size={14} className="shrink-0 text-brand-200" />
              <span>
                <span className="font-semibold">90% Electric, Hybrid &amp; Ecological.</span> On the road to
                100% environmentally friendly by 2030.
              </span>
            </p>
          </div>
          <Header />
          {!fullBleed && <LocationPrompt />}
          <main className={cn('flex-1', fullBleed && 'min-h-0 overflow-hidden')}>
            <Outlet />
          </main>
          {!fullBleed && <Footer />}
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
