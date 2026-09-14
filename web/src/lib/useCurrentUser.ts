import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { useAuth } from '@/lib/auth';

/**
 * The logged-in user's profile, loaded from Supabase. Replaces the old
 * hardcoded `currentUser` mock. Only runs when there's a session (the data
 * client needs one), so it's safe to call on public routes too.
 *
 * A missing row resolves to `null`, never `undefined`: `getCurrentUser()`
 * maps an absent row to `undefined`, and React Query rejects `undefined` as
 * query data — which turned "this session has no profile row" into the error
 * state, indistinguishable from the network being down. `RequireRole` draws
 * that line (an error gets a Retry notice, an absent row goes home), so the
 * hook has to hand it two different values.
 */
export function useCurrentUser() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => (await client.getCurrentUser()) ?? null,
    enabled: !!user,
  });
}
