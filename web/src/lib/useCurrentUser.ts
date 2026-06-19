import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { useAuth } from '@/lib/auth';

/**
 * The logged-in user's profile, loaded from Supabase. Replaces the old
 * hardcoded `currentUser` mock. Only runs when there's a session (the data
 * client needs one), so it's safe to call on public routes too.
 */
export function useCurrentUser() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: () => client.getCurrentUser(),
    enabled: !!user,
  });
}
