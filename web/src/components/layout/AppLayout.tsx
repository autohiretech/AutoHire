import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Header } from './Header';
import { Footer } from './Footer';

export function AppLayout() {
  const { pathname } = useLocation();
  // Messaging is a full-bleed app screen: fills the viewport, no footer.
  const fullBleed = pathname === '/messages' || pathname.startsWith('/messages/');

  return (
    <div className={cn('flex flex-col', fullBleed ? 'h-full overflow-hidden' : 'min-h-full')}>
      <Header />
      <main className={cn('flex-1', fullBleed && 'min-h-0 overflow-hidden')}>
        <Outlet />
      </main>
      {!fullBleed && <Footer />}
    </div>
  );
}
