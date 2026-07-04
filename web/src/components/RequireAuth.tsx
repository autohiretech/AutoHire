import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

/**
 * Gates a route to signed-in users. Guests can browse the public pages (home,
 * car listings), but anything that acts on an account — booking, trips,
 * messages, notifications, verification, the profile — sends them to /login,
 * remembering where they were headed so LoginPage can bounce them back after
 * they sign in or create an account.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }
  return <>{children}</>;
}
