import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { UserRole } from '@autohire/shared';
import { useAuth } from '@/lib/auth';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Spinner } from '@/components/ui';

/**
 * Gates a route to accounts whose profile role is in `roles`. Guests are sent
 * to /login (remembering where they were headed); signed-in users whose role
 * isn't allowed are sent home. Renders a spinner while the profile loads. This
 * complements RLS (the real boundary) by keeping host/admin pages off-limits in
 * the UI instead of rendering them empty.
 */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const { data: profile, isLoading } = useCurrentUser();

  // Not signed in — send to login so they can create an account or sign in.
  if (!loading && !user) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }

  if (loading || isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }
  if (!profile || !roles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
