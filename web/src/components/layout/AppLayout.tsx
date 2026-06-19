import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/useRealtime';
import { Spinner } from '@/components/ui';
import { Header } from './Header';
import { Footer } from './Footer';

export function AppLayout() {
  const { pathname } = useLocation();
  const { user, loading } = useAuth();

  // Live messages / unread badges / notifications (no-op until signed in).
  useRealtime();

  // Require a Supabase session to see anything in the app shell.
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }

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
