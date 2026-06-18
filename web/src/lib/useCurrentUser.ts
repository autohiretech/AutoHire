import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';

/**
 * The logged-in user's profile, loaded from Supabase. Replaces the old
 * hardcoded `currentUser` mock. Only meaningful inside the authenticated app
 * shell (the data client needs a session), so callers should treat the result
 * as possibly-undefined while it loads.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: () => client.getCurrentUser(),
  });
}
