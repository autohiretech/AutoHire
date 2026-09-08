import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { useCountry } from '@/lib/country';
import { useAppMode } from '@/lib/appMode';
import { ResultsMap } from '@/components/map/ResultsMap';
import { Sheet, type SheetDetent } from '@/components/ui';
import { ListingRowSkeleton } from '@/components/skeletons';
import { ListingCard } from '@/components/ListingCard';
import { ResearchField } from '@/components/research/ResearchField';
import { HostAiPage } from '@/pages/HostAiPage';
import { AI_FILTERS_KEY, loadAiFilters } from '@/lib/aiFilters';

/**
 * `/ai` splits on `mode` before anything else runs — a host has no use for
 * the renter build's car-search query, map or filters state, so it gets its
 * own page (`HostAiPage`) rather than this component's hooks running for a
 * fleet they'll never see. `RenterAiPage` below is exactly what this file
 * used to be end to end.
 */
export function AiPage() {
  const { mode } = useAppMode();
  return mode === 'host' ? <HostAiPage /> : <RenterAiPage />;
}

/**
 * RenterAiPage — the renter's `/ai`, full-bleed like /search but built
 * entirely around ResearchField instead of manual filter chips. The map
 * fills the whole page in both layouts; a mobile bottom sheet and a desktop
 * floating panel are just two different ways of showing the same result
 * list over it, so there's exactly one `ResultsMap` and one place the
 * filters live, regardless of breakpoint.
 *
 * Unlike /search (plain browse — chips the renter clicks, no AI involved),
 * every filter change here comes from ResearchField's `onFilters`, which is
 * the same ListingFilters-shaped callback /search's own chip row calls —
 * "the AI wrote this" and "I clicked this" are indistinguishable to the
 * query underneath, which is the point: whichever touched it last wins, and
 * dropping an understanding-chip here is exactly unclicking a filter there.
 */
function RenterAiPage() {
  const { country, currency } = useCountry();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const [filters, setFilters] = useState<ListingFilters>(() => ({
    ...loadAiFilters(),
    country: loadAiFilters().country ?? country.code,
  }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>('peek');

  // `?ask=` runs once, then is stripped so a refresh doesn't repeat it — the
  // same hand-off HomePage's hero field uses.
  const initialAskRef = useRef(params.get('ask'));
  const [aiPending, setAiPending] = useState(() => !!initialAskRef.current);
  useEffect(() => {
    if (!initialAskRef.current) return;
    const next = new URLSearchParams(params);
    next.delete('ask');
    setParams(next, { replace: true });
    // Strip once, on mount, regardless of later param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!aiPending) return;
    const t = setTimeout(() => setAiPending(false), 12000);
    return () => clearTimeout(t);
  }, [aiPending]);

  // Arriving from a specific car's page (not currently linked from anywhere
  // in the app, but AiPage honors it if a future entry point sets it) —
  // "book this one" then resolves without asking which car.
  const navState = location.state as { from?: string; listingId?: string } | null;
  const fromRoute = navState?.from ?? params.get('from') ?? undefined;
  const fromListingId = navState?.listingId ?? params.get('listingId') ?? undefined;

  useEffect(() => {
    try {
      sessionStorage.setItem(AI_FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Private mode / quota — filters still work this page view.
    }
  }, [filters]);

  const { data: listings, isLoading } = useQuery({
    queryKey: ['search', filters],
    queryFn: () => client.listListings(filters),
  });
  const results = listings ?? [];

  function onFilters(patch: ListingFilters, clear?: (keyof ListingFilters)[]) {
    setAiPending(false);
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      for (const key of clear ?? []) delete next[key];
      return next;
    });
  }
  function onRemoveFilter(key: keyof ListingFilters) {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  function onClearFilters() {
    setFilters({ country: country.code });
    setHighlightIds([]);
  }

  function rowProps(l: (typeof results)[number]) {
    return {
      listing: l,
      layout: 'row' as const,
      isActive: l.id === activeId || highlightIds.includes(l.id),
      onHover: (hovering: boolean) => setActiveId(hovering ? l.id : null),
    };
  }
  function onMarkerSelect(l: (typeof results)[number]) {
    setActiveId(l.id);
    setSheetDetent('half');
  }

  // Measures the field dock's actual rendered height (it grows when a line
  // or chip row appears) so the mobile results sheet can sit flush above it
  // instead of a hand-picked pixel guess that would either leave a gap or —
  // worse — get covered the first time a longer line wraps.
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(64);
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setDockHeight(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const researchField = (
    <ResearchField
      filters={filters}
      onFilters={onFilters}
      onHighlight={setHighlightIds}
      onRemoveFilter={onRemoveFilter}
      onClearFilters={onClearFilters}
      results={results}
      country={filters.country ?? country.code}
      currency={currency}
      fromRoute={fromRoute}
      fromListingId={fromListingId}
      initialAsk={initialAskRef.current}
      onConsumedInitialAsk={() => setAiPending(false)}
    />
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Map — the full-bleed background in both layouts. `isolate` scopes
          Leaflet's own z-index scale to inside this box (its zoom control
          sits at 1000), same reason /search's map does it. */}
      <div className="isolate absolute inset-0">
        <ResultsMap
          listings={results}
          activeId={activeId}
          onHover={setActiveId}
          highlightIds={highlightIds}
          onSelect={onMarkerSelect}
          focusPoint={null}
        />
      </div>

      {/* Mobile results sheet. Its containing block is this page's own
          `relative h-full` root, which — below `md`, while signed in — is
          already shortened by AppLayout's `main` padding-bottom to clear
          BottomTabBar (the same mechanism /search's own Sheet relies on, see
          TOGGLE_BOTTOM_CLASS there). So this only needs to clear the field
          dock itself, tracked live via `dockHeight` — not the tab bar again,
          which would double-count the offset and leave a dead gap. */}
      <div
        className="absolute inset-x-0 top-0 z-20 transition-[bottom] duration-200 lg:hidden"
        style={{ bottom: `calc(${dockHeight}px + 12px)` }}
      >
        <div className="relative h-full">
          <Sheet
            detent={sheetDetent}
            onDetentChange={setSheetDetent}
            header={
              <p className="text-body-sm font-semibold text-[var(--color-content)]">
                <span className="tabular">{results.length}</span> car{results.length === 1 ? '' : 's'}
              </p>
            }
          >
            {isLoading || aiPending ? (
              <div className="flex flex-col gap-3 px-4 pb-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <ListingRowSkeleton key={i} />
                ))}
              </div>
            ) : results.length > 0 ? (
              <div className="flex flex-col gap-3 px-4 pb-4">
                {results.map((l) => (
                  <ListingCard key={l.id} {...rowProps(l)} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 pb-6 pt-2 text-center">
                <Search size={24} className="text-[var(--color-content-subtle)]" />
                <p className="font-medium text-[var(--color-content)]">Nothing yet.</p>
                <p className="text-body-sm text-[var(--color-content-muted)]">
                  Tell the field what you're looking for.
                </p>
              </div>
            )}
          </Sheet>
        </div>
      </div>

      {/* Desktop — a floating results panel over the map, right-aligned so
          the field (top-centre, below) reads as the whole page's focus
          rather than competing with a full side column. */}
      <div className="absolute bottom-4 right-4 top-4 z-20 hidden w-[380px] overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)] lg:block">
        {isLoading || aiPending ? (
          <div className="divide-y divide-[var(--color-line)]">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="p-3">
                <ListingRowSkeleton />
              </div>
            ))}
          </div>
        ) : results.length > 0 ? (
          <div className="divide-y divide-[var(--color-line)]">
            {results.map((l) => (
              <div key={l.id} className="p-3">
                <ListingCard key={l.id} {...rowProps(l)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Search size={28} className="text-[var(--color-content-subtle)]" />
            <p className="font-medium text-[var(--color-content)]">Nothing yet.</p>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              Tell the field what you're looking for.
            </p>
          </div>
        )}
      </div>

      {/* The field dock. Mobile: fixed above the tab bar (thumb reach).
          Desktop: absolute, top-centre of the page — with the results panel
          floating on the right, this reads as top-centre of the map. */}
      <div
        ref={dockRef}
        className="fixed inset-x-3 z-30 bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))] md:bottom-3 lg:absolute lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-5 lg:w-full lg:max-w-lg lg:-translate-x-1/2"
      >
        {researchField}
      </div>
    </div>
  );
}
