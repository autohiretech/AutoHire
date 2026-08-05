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
    <NotificationsProvider>
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
      </div>
    </NotificationsProvider>
  );
}
