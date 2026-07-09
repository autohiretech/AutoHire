import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useRealtime } from '@/lib/useRealtime';
import { Header } from './Header';
import { Footer } from './Footer';
import { RightRail } from './RightRail';
import { LocationPrompt } from '@/components/marketplace/LocationPrompt';
import { ScrollMemory } from '@/components/ScrollMemory';

export function AppLayout() {
  const { pathname } = useLocation();

  // Live messages / unread badges / notifications (no-op until signed in).
  useRealtime();

  // No session gate here: guests can browse the shell (home, car listings) and
  // only get sent to /login when they hit an account-only route (RequireAuth /
  // RequireRole gate those individually).

  // Messaging is a full-bleed app screen: fills the viewport, no footer.
  const fullBleed = pathname === '/messages' || pathname.startsWith('/messages/');

  return (
    <div className={cn('flex flex-col', fullBleed ? 'h-full overflow-hidden' : 'min-h-full')}>
      <ScrollMemory />
      <Header />
      {!fullBleed && <LocationPrompt />}
      <main className={cn('flex-1', fullBleed && 'min-h-0 overflow-hidden')}>
        <Outlet />
      </main>
      {!fullBleed && <Footer />}
      <RightRail />
    </div>
  );
}
