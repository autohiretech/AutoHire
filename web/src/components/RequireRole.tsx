import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { UserRole } from '@autohire/shared';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Spinner } from '@/components/ui';

/**
 * Gates a route to accounts whose profile role is in `roles`. Renders a spinner
 * while the profile loads, then redirects home if the role isn't allowed. This
 * complements RLS (the real boundary) by keeping host/admin pages off-limits in
 * the UI instead of rendering them empty.
 */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { data: profile, isLoading } = useCurrentUser();

  if (isLoading) {
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
