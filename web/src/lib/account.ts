import type { Host, UserProfile } from '@autohire/shared';
import { useCurrentUser } from '@/lib/useCurrentUser';

/**
 * True when the signed-in account is a business / company host. Business
 * accounts are hosts only — they list and manage a fleet but cannot rent cars
 * themselves. (Personal accounts, including individual hosts, can rent.)
 */
export function useIsBusinessHost(): boolean {
  const { data } = useCurrentUser();
  const profile = data as (UserProfile & Partial<Host>) | undefined;
  return profile?.ownerType === 'business';
}

/**
 * True when the signed-in account is in the Hosting experience (role 'owner') —
 * either a company or a personal account that became a host. Hosts are host-only
 * and rent by switching back to a renter account from their profile.
 */
export function useIsHost(): boolean {
  const { data } = useCurrentUser();
  return data?.role === 'owner';
}
