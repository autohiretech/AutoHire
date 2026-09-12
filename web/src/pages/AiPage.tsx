import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { useCountry } from '@/lib/country';
import { useAppMode } from '@/lib/appMode';
import { ResultsMap } from '@/components/map/ResultsMap';
import { MapListToggle, Sheet, type SheetDetent } from '@/components/ui';
import { ListingRowSkeleton } from '@/components/skeletons';
import { ListingCard } from '@/components/ListingCard';
import { ResearchField } from '@/components/research/ResearchField';
import { ResultsRail } from '@/components/research/ResultsRail';
import { AiChat, type ChatMessage } from '@/components/AiChat';
import { HostAiPage } from '@/pages/HostAiPage';
import { AI_FILTERS_KEY, loadAiFilters } from '@/lib/aiFilters';
import { loadHomeLocation, subscribeHomeLocation } from '@/lib/homeLocation';

/**
 * `/ai` splits on `mode` before anything else runs — a host has no use for
 * the renter build's car-search query, map or filters state, so it gets its
 * own page (`HostAiPage`) rather than this component's hooks running for a
 * fleet they'll never see. `RenterAiPage` below is exactly what this file
 * used to be end to end.
 */
/** Mirrors Sheet.tsx's own `detentClass` heights. Kept here so the floating
 * map/list toggle can sit just above whichever height the sheet currently
 * is; if those change, this changes with them. */
const SHEET_HEIGHT: Record<SheetDetent, string> = {
  // `peek` is the rail's height, not the Sheet's — at that detent the rail
  // stands in for the sheet, and this is only ever used to park the
  // map/list toggle just above whatever is currently down there.
  peek: '78px',
  half: '55svh',
  full: '92svh',
};

/** How many cars the collapsed rail holds. A filter can match hundreds —
 * 308 in the case that prompted this — and every card in the rail is a real
 * DOM node with a real image, on a phone, over a live map. Nobody swipes
 * three hundred cards sideways; the ones worth seeing are at the front,
 * and "List" opens the full set. */
const RAIL_MAX = 30;

/**
 * How many results the map draws as cards rather than price pins.
 *
 * The map is where a research answer lands, and until now it landed as
 * anonymous count badges: ask for "a tractor for cultivating", get a
 * sentence, a list off to the side, and a map of green circles with numbers
 * in them. `highlightIds` — the mechanism for drawing a result as its own
 * photo card — was only ever fed by the agent's `highlight` action, and no
 * tool on the server has ever emitted one, so in practice it was always
 * empty and the card path never ran.
 *
 * So the top of the ranking is spotlit by default: whatever the current
 * filters put first is what the assistant is answering with, and those are
 * the cars the map shows as cards. An explicit `highlight` from the agent
 * still wins outright when one ever arrives.
 *
 * The cap is about how much of the ranking is worth carrying, not how many
 * cards fit on screen — ResultsMap decides that per marker at the current
 * zoom, and demotes what doesn't fit to a pin or a cluster.
 */
const SPOTLIGHT_MAX = 24;

/** The renter's saved coordinate as distance-ranking filters, or nothing at
 * all when they never set one — never a stand-in city, and never a fresh
 * geolocation prompt fired just from opening a page. */
function nearMe(): Pick<ListingFilters, 'nearLat' | 'nearLng'> {
  const home = loadHomeLocation();
  return home ? { nearLat: home.lat, nearLng: home.lng } : {};
}

/** The transcript's own key. Per-tab and separate from ResearchField's
 * `autohire-ai-convo` for the same reason the two are separate pieces of
 * state: that stores the one live line the field is showing, this stores the
 * conversation the page is rendering, and a reload should restore both
 * without either owning the other. */
const CHAT_KEY = 'autohire-ai-chat';

function loadChat(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

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
  const { country, currency, setCountry } = useCountry();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const [filters, setFilters] = useState<ListingFilters>(() => {
    const stored = loadAiFilters();
    return {
      ...stored,
      country: stored.country ?? country.code,
      // "Cars around me" without a fresh GPS prompt. The renter's saved
      // coordinate (Account → Your location, or the banner under the header)
      // already reached the *agent* as `context.location`, but nothing was
      // putting it into the query — so the model could say "here's what's
      // near you" over a list still ordered by rating. `nearLat`/`nearLng`
      // is migration 075's haversine order-by and excludes nothing, so this
      // can only change what's at the top.
      //
      // Only when the stored filters name no place of their own. A carried
      // city or a coordinate that arrived with the hand-off is somewhere the
      // renter asked about, and ranking *that* by distance from home would
      // sort a search for Musanze by how far each car is from Kigali. Same
      // precedence /search applies in its own `startPoint`.
      ...(stored.city || stored.nearLat != null ? {} : nearMe()),
    };
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>('peek');

  // A location fix acquired anywhere else — the prompt under the header,
  // Account → Your location — reaching this page without a reload.
  //
  // `nearMe()` above runs once, at mount, off whatever was already stored. So
  // a renter who opened /ai first and granted permission afterwards had their
  // coordinate saved and their map still ranked by rating: the fix existed,
  // and the only thing standing between it and the query was that nothing
  // re-read it. `subscribeHomeLocation` fires on this tab precisely so a page
  // already open can pick it up.
  //
  // The precedence is the seed's, re-checked at the instant the fix lands
  // rather than assumed from mount: a city the renter has since named, or a
  // coordinate that came with a hand-off, is a place they asked about, and
  // re-ranking that around where they happen to be standing answers a
  // different question than the one on screen. This only ever fills a gap.
  useEffect(
    () =>
      subscribeHomeLocation((home) => {
        if (!home) return;
        setFilters((prev) =>
          prev.city || prev.nearLat != null
            ? prev
            : { ...prev, nearLat: home.lat, nearLng: home.lng },
        );
      }),
    [],
  );

  // The conversation, which the field reports and this page renders. See
  // AiChat: the field keeps its single status line, the answers accumulate
  // here so they survive the next turn starting.
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat);
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages));
    } catch {
      // Private mode / quota — the conversation still holds for this view.
    }
  }, [messages]);

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

  function onFilters(patch: ListingFilters, clear?: (keyof ListingFilters)[], replace?: boolean) {
    setAiPending(false);
    // The agent sends the complete filter set it wants, not a patch, so its
    // omissions are meaningful — they are the filters it chose to drop.
    // Country is the one thing it may not lose: the market comes from the
    // header, and a turn that forgot it would silently widen the search to
    // every country.
    if (replace) {
      setFilters({ country: country.code, ...patch });
      return;
    }
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      // Where the renter is beats the name of the city they are in — and
      // that has to be a property of this state, not of one call path.
      //
      // A patch that brings a coordinate is a fresh answer to "where", so a
      // city already sitting in `prev` is stale relative to it and goes.
      // `city` is a hard `.eq()` — a boundary — and ANDing it with a
      // distance sort silently deletes the very cars the coordinate was
      // asked for: the ones a few minutes away over a district line. The
      // coordinate excludes nothing and only ranks (migration 075), so it
      // takes the city's place rather than sitting beside it.
      //
      // A city arriving in the patch itself is the opposite case and stands:
      // that is the renter naming somewhere ("cars in Musanze"), not
      // something inferred from where they happen to be standing, and the
      // coordinate is then just the order they are listed in.
      //
      // This lived in the callers before, and one of them didn't have it.
      // `onPointMatch` was safe only because SearchBar happens to fire
      // `onCityMatch(undefined)` immediately before it; "Closest to me"
      // bypasses SearchBar entirely and inherited none of that, so a city
      // matched moments earlier out of typed text or a picked recent — both
      // legitimately city-only at the time, neither carrying a coordinate —
      // survived the tap and boundaried away the nearest cars.
      //
      // `== null`, not falsy: latitude 0 is the equator, which runs through
      // real markets in this catalogue.
      if (patch.nearLat != null && patch.nearLng != null && patch.city == null) delete next.city;
      // A field set in this same patch wins over a clear of that field.
      // The model does sometimes send both — asked for cars in Rusizi it
      // returned `filters: {city:'Rusizi'}` alongside `clear: ['city']` —
      // and because clear ran last, the city it had just set was deleted.
      // The renter was left with the stale filters and no city, while the
      // reply claimed to be showing Rusizi. Setting a value is the more
      // specific instruction, so it wins.
      for (const key of clear ?? []) {
        if (!(key in patch)) delete next[key];
      }
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

  // The assistant's explicit picks when it ever sends any, else the head of
  // the current ranking — see SPOTLIGHT_MAX. Filtered to what the current
  // result set actually contains, so a highlight left over from a previous
  // turn can't keep pointing at cars that are no longer on the map.
  const spotlightIds = useMemo(() => {
    const ids = new Set(results.map((l) => l.id));
    const explicit = highlightIds.filter((id) => ids.has(id));
    if (explicit.length > 0) return explicit;
    return results.slice(0, SPOTLIGHT_MAX).map((l) => l.id);
  }, [results, highlightIds]);

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
      onCountryMatch={(code) => setCountry(code)}
      onMessage={(m) =>
        setMessages((prev) => [
          ...prev,
          // `crypto.randomUUID` needs a secure context and this runs on one,
          // but a plain counter fallback keeps a keyed list stable rather
          // than throwing on an http:// dev host.
          { ...m, id: globalThis.crypto?.randomUUID?.() ?? `m${prev.length}-${Date.now()}` },
        ])
      }
      onBusyChange={setAiBusy}
      onReset={() => setMessages([])}
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
          highlightIds={spotlightIds}
          onSelect={onMarkerSelect}
          focusPoint={null}
        />
      </div>

      {/* The conversation, over the map.
          On a phone it hangs from the top: the field dock, the rail and the
          sheet all stack upward from the bottom, and adding a fourth thing to
          that stack would mean measuring the other three. The map is behind
          it either way, and the top edge is otherwise empty.
          On desktop it takes the bottom-left — the field is top-centre and the
          results panel is top-right, so this is the corner nothing else wants,
          and it reads as the assistant talking beside its own results. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex max-h-[38svh] flex-col lg:inset-x-auto lg:bottom-4 lg:left-4 lg:top-auto lg:max-h-[46vh] lg:w-[380px]">
        <AiChat messages={messages} busy={aiBusy} className="max-h-full" />
      </div>

      {/* Mobile results sheet. Its containing block is this page's own
          `relative h-full` root, which — below `md`, while signed in — is
          already shortened by AppLayout's `main` padding-bottom to clear
          BottomTabBar (the same mechanism /search's own Sheet relies on, see
          TOGGLE_BOTTOM_CLASS there). So this only needs to clear the field
          dock itself, tracked live via `dockHeight` — not the tab bar again,
          which would double-count the offset and leave a dead gap. */}
      {/* Collapse the results to see the map. The sheet could always be
          dragged down by its handle, but a handle is not a discoverable
          control — the list covered the map and there was no visible way to
          say "show me the map". /search has had this pill for exactly this
          reason; /ai simply never got one.

          It rides above the sheet's current height, and on this page that
          height also sits above the field dock, so the offset is the dock
          plus the sheet rather than /search's fixed constants. */}
      <div
        className="absolute left-1/2 z-30 -translate-x-1/2 transition-[bottom] duration-200 lg:hidden"
        style={{ bottom: `calc(${dockHeight}px + 12px + ${SHEET_HEIGHT[sheetDetent]} + 12px)` }}
      >
        <MapListToggle
          showing={sheetDetent === 'peek' ? 'map' : 'list'}
          onToggle={() => setSheetDetent((d) => (d === 'peek' ? 'half' : 'peek'))}
        />
      </div>

      {/* `pointer-events-none` on the two wrappers, `auto` on the sheet.
          This container spans from the top of the page down to the dock so
          the sheet inside it can be bottom-anchored, but it is transparent
          and was still swallowing every tap over the map — the Satellite
          toggle, the zoom controls and the markers were all dead on a phone
          while the sheet sat at `peek` showing nothing there. Only the sheet
          itself should take pointer events. */}
      {/* Collapsed state on a phone: a swipeable rail instead of a sheet.
          The complaint this answers is that the car list was too big and
          buried the map — and collapsing the sheet solved that by hiding the
          results altogether, which is not much better on a page whose whole
          job is "here are cars, and here is where they are". The rail keeps
          both: the map holds the full screen behind it, the cars stay one
          swipe away, and pulling the list up is still there for scanning
          properly. */}
      {sheetDetent === 'peek' && results.length > 0 && !isLoading && !aiPending && (
        <div
          className="absolute inset-x-0 z-20 transition-[bottom] duration-200 lg:hidden"
          style={{ bottom: `calc(${dockHeight}px + 12px)` }}
        >
          <ResultsRail
            listings={results.slice(0, RAIL_MAX)}
            activeId={activeId}
            onHover={setActiveId}
            onSelect={(l) => setActiveId(l.id)}
          />
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 transition-[bottom] duration-200 lg:hidden"
        style={{ bottom: `calc(${dockHeight}px + 12px)` }}
      >
        <div className="pointer-events-none relative h-full">
          {sheetDetent !== 'peek' && (
          <Sheet
            className="pointer-events-auto"
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
          )}
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
