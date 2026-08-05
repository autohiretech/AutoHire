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

/**
 * True when the signed-in account may rent a car. Hosts (role 'owner') and
 * company accounts (owner_type 'business') are host-only: they can browse and
 * view every listing but never book one. A company stays blocked even if its
 * role is still 'renter'. Guests are allowed through — the flow routes them to
 * sign in first. The Edge Functions and the `booking_renter_guard` trigger
 * enforce the same rule server-side.
 */
export function useCanRent(): boolean {
  const { data } = useCurrentUser();
  const profile = data as (UserProfile & Partial<Host>) | undefined;
  if (!profile) return true;
  return profile.role !== 'owner' && profile.ownerType !== 'business';
}
