import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';

interface AiHandlers {
  onFilters?: (filters: ListingFilters, clear?: (keyof ListingFilters)[]) => void;
  onHighlight?: (ids: string[]) => void;
}

interface AiStateValue {
  contextListings: Listing[];
  resultsLoading: boolean;
  /** Filters actually driving the current page's results right now — from
   * the assistant's own earlier turns, or the renter clicking a filter chip
   * directly. Sent back to the model on the next ask() so it can `clear`
   * whatever conflicts with a genuinely new request instead of silently
   * narrowing results toward zero alongside it (it has no other way to see
   * a chip-set filter). */
  activeFilters: ListingFilters;
}

interface AiActionsValue {
  handlers: React.MutableRefObject<AiHandlers>;
  setSource: (listings: Listing[], loading: boolean, filters?: ListingFilters) => void;
  setHandlers: (handlers: AiHandlers) => void;
  /** Opens the assistant and shows info on this car — what a map marker's
   * click (or any other "pick this one" affordance) triggers. Not a booking
   * request by itself: it surfaces the car and asks whether the renter wants
   * to book it or see the full listing, same as clicking one would feel like
   * doing in person, rather than assuming "clicked" means "book this now." */
  selectForBooking: (listing: Listing) => void;
  registerSelectForBooking: (fn: (listing: Listing) => void) => void;
}

// Split in two, deliberately: AiStateContext changes on every search result /
// highlight update, AiActionsContext never changes identity after mount. A
// page that only needs to *register* its listings (useAiAssistantSource)
// subscribes to actions alone — if it also subscribed to state, then calling
// its own setSource would re-render that page, which (on a page that builds
// its listings array inline, e.g. `[listing]`) rebuilds that array, which
// re-fires the registration effect, which calls setSource again: an infinite
// render loop. This bit CarDetailPage for exactly that reason before the
// split — Maximum update depth exceeded, page fully unresponsive.
const AiStateContext = createContext<AiStateValue | null>(null);
const AiActionsContext = createContext<AiActionsValue | null>(null);

/**
 * The one global AI assistant needs to know which cars are "in view" no
 * matter which page it's asked from — the search results list, or just the
 * one car on its own detail page — so "book this one" always has something
 * concrete to resolve against. Wraps the whole app (in AppLayout) so the
 * assistant survives route changes; individual pages publish their own
 * current listings into it via `useAiAssistantSource` below.
 */
export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [contextListings, setContextListings] = useState<Listing[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ListingFilters>({});
  // Handlers live in a ref, not state — they're only ever read at the moment
  // a message is sent, never rendered, so there's no reason for setting them
  // to re-render the assistant.
  const handlers = useRef<AiHandlers>({});
  // The assistant itself registers its own "open + ask to book this" here
  // once it mounts. Before that (or on /dashboard, where it isn't mounted)
  // this is a no-op rather than a crash.
  const selectForBookingFn = useRef<(listing: Listing) => void>(() => {});

  const setSource = useCallback((listings: Listing[], loading: boolean, filters?: ListingFilters) => {
    setContextListings(listings);
    setResultsLoading(loading);
    setActiveFilters(filters ?? {});
  }, []);
  const setHandlers = useCallback((h: AiHandlers) => {
    handlers.current = h;
  }, []);
  const selectForBooking = useCallback((listing: Listing) => selectForBookingFn.current(listing), []);
  const registerSelectForBooking = useCallback((fn: (listing: Listing) => void) => {
    selectForBookingFn.current = fn;
  }, []);

  // Stable across the provider's whole lifetime — every field is either a
  // ref or a useCallback with no deps, so this object's identity itself
  // could be memoized with an empty dep array, but useRef(...).current is
  // simpler and just as effective for "compute once."
  const actions = useRef<AiActionsValue>({
    handlers,
    setSource,
    setHandlers,
    selectForBooking,
    registerSelectForBooking,
  }).current;

  const state = useMemo<AiStateValue>(
    () => ({ contextListings, resultsLoading, activeFilters }),
    [contextListings, resultsLoading, activeFilters],
  );

  return (
    <AiActionsContext.Provider value={actions}>
      <AiStateContext.Provider value={state}>{children}</AiStateContext.Provider>
    </AiActionsContext.Provider>
  );
}

/** The frequently-changing half — which listings are in view, and whether
 * they're still loading. Only the assistant panel itself needs this. */
export function useAiAssistantState() {
  const ctx = useContext(AiStateContext);
  if (!ctx) throw new Error('useAiAssistantState must be used within AiAssistantProvider');
  return ctx;
}

/** The never-changes-identity half — registration functions and the
 * cross-component triggers (selectForBooking). Safe for a page to depend on
 * without risking a re-render loop from its own registration effect. */
export function useAiAssistantActions() {
  const ctx = useContext(AiActionsContext);
  if (!ctx) throw new Error('useAiAssistantActions must be used within AiAssistantProvider');
  return ctx;
}

/** Convenience for a consumer (the assistant panel itself) that genuinely
 * needs both halves and is expected to re-render when state changes. Pages
 * that only register listings should use useAiAssistantSource, or
 * useAiAssistantActions directly for things like selectForBooking — not
 * this — precisely to avoid subscribing to state they don't render. */
export function useAiAssistantContext() {
  return { ...useAiAssistantState(), ...useAiAssistantActions() };
}

/**
 * A page calls this to tell the global assistant which cars it's currently
 * showing, and — only where it makes sense — how to act on a filter change
 * or a highlight. A car detail page passes just its one listing and no
 * handlers; the assistant falls back to navigating to /search for anything
 * filter-shaped, and skips highlighting since there's nothing here to
 * highlight against. Unregisters on unmount so a page's cars don't linger
 * in context after the renter navigates elsewhere.
 */
export function useAiAssistantSource(
  listings: Listing[],
  options?: {
    loading?: boolean;
    onFilters?: (filters: ListingFilters, clear?: (keyof ListingFilters)[]) => void;
    onHighlight?: (ids: string[]) => void;
    /** The filters actually driving `listings` right now — see AiStateValue's
     * `activeFilters` for why the model needs to see this. */
    filters?: ListingFilters;
  },
) {
  // Actions only, deliberately — see the block comment above the contexts.
  const { setSource, setHandlers } = useAiAssistantActions();
  const loading = options?.loading ?? false;
  const filters = options?.filters;
  useEffect(() => {
    setSource(listings, loading, filters);
    setHandlers({ onFilters: options?.onFilters, onHighlight: options?.onHighlight });
    return () => setSource([], false);
    // Handlers are re-captured every run via the closure above, but aren't
    // themselves a dependency — they're inline callbacks that get a new
    // identity every render, and re-running this for that alone would fight
    // the assistant's own in-flight requests for no real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, loading, filters, setSource, setHandlers]);
}
