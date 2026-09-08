import type { ReactNode } from 'react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';

/**
 * Legacy plumbing, kept only so callers written for the old design still
 * compile. The AI used to be one assistant mounted globally (in AppLayout),
 * so any page could "publish" its current listings into a shared context for
 * it to read from wherever the renter happened to be. It's now AiPage's own
 * screen (`/ai`) — self-contained, wired directly by AiPage itself — so
 * there's no cross-page context left to maintain.
 *
 * `useAiAssistantSource` is now a no-op: registering a page's listings here
 * doesn't do anything anymore. CarDetailPage still calls it; that's fine —
 * nothing reads the result.
 */
export function AiAssistantProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAiAssistantSource(
  _listings: Listing[],
  _options?: {
    loading?: boolean;
    onFilters?: (filters: ListingFilters, clear?: (keyof ListingFilters)[]) => void;
    onHighlight?: (ids: string[]) => void;
    filters?: ListingFilters;
  },
) {
  // Intentionally empty.
}
