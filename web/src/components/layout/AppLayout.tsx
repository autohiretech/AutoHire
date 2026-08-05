import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Leaf, X } from 'lucide-react';
import { client } from '@/lib/client';
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
        <EcoBanner />
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

const ECO_BANNER_KEY = 'autohire.ecoBanner';

/**
 * Top eco-commitment banner. The headline % is the LIVE electric share of the
 * fleet (falls back to the pledge figure until it loads), the bar links to the
 * electric fleet, and it can be dismissed (remembered per browser).
 */
function EcoBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ECO_BANNER_KEY) === 'off';
    } catch {
      return false;
    }
  });

  const { data: quota } = useQuery({
    queryKey: ['electricQuota'],
    queryFn: () => client.getElectricQuota(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (dismissed) return null;

  // Live electric share of the fleet; the pledge figure (90) until data loads.
  const pct = quota && quota.totalCars > 0 ? Math.round((quota.electricCars / quota.totalCars) * 100) : 90;

  const dismiss = () => {
    try {
      localStorage.setItem(ECO_BANNER_KEY, 'off');
    } catch {
      /* storage disabled — dismiss for this session only */
    }
    setDismissed(true);
  };

  return (
    <div className="relative bg-brand-700 text-white">
      <Link
        to="/?fuel=electric"
        className="group mx-auto flex max-w-[1500px] items-center justify-center gap-2 px-9 py-1.5 text-center text-xs font-medium transition-colors hover:bg-brand-800 sm:text-[13px]"
      >
        <Leaf size={14} className="shrink-0 text-brand-200" aria-hidden="true" />
        <span className="hidden sm:inline">
          <span className="font-semibold">{pct}% Electric, Hybrid &amp; Ecological.</span> On the road to 100%
          environmentally friendly by 2030.
        </span>
        <span className="sm:hidden">
          <span className="font-semibold">{pct}% clean-energy fleet</span> · 100% by 2030
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 font-semibold underline-offset-2 group-hover:underline md:inline-flex">
          See electric cars <ChevronRight size={13} />
        </span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}
