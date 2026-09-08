import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Navigation, Search } from 'lucide-react';
import type { ListingFilters } from '@/lib/types';
import { cn } from '@/lib/cn';
import { client } from '@/lib/client';
import { CAR_CATEGORIES } from '@/lib/categories';
import { interpretQuery } from '@/lib/demoAi';
import { ResultsMap } from '@/components/map/ResultsMap';
import { Chip, ChipRow, Button, Sheet, MapListToggle, Skeleton, type SheetDetent } from '@/components/ui';
import { ListingRowSkeleton } from '@/components/skeletons';
import { ListingCard } from '@/components/ListingCard';
import { useCountry } from '@/lib/country';
import { citiesFor, countryOfCity } from '@/lib/cities';
import { MORE_FILTERS, PRICE_FILTER } from '@/components/marketplace/SearchFilters';
import { useAddressSuggestions, type AddressSuggestion } from '@/lib/geocoding';
import { useMyLocation } from '@/lib/useMyLocation';

// Floating "map/list" toggle sits a fixed gap above the sheet's current
// height, so it never overlaps the sheet no matter which detent it's in.
const TOGGLE_BOTTOM_CLASS: Record<SheetDetent, string> = {
  peek: 'bottom-[104px]',
  half: 'bottom-[calc(55svh+16px)]',
  full: 'bottom-[calc(92svh+16px)]',
};

/**
 * Search results page — plain, manual browse: a slim filter chip row, a
 * narrow result list, and a map that takes most of the page on desktop; on
 * mobile the map is the whole screen and the list lives in a bottom sheet
 * over it, since in Kigali "where is this car relative to me" is the
 * question a `hidden lg:block` map answered for nobody on a phone. No AI
 * here — that's its own screen (`/ai`), built around the same `ListingFilters`
 * shape but with its own field, session, and result view. Landing here with
 * `state.filters` (AiPage's "Show in browse" chip sets this) seeds the chips
 * below with whatever the AI had already understood.
 */
export function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const { country } = useCountry();
  const location = useLocation();
  const handoffFilters = (location.state as { filters?: ListingFilters } | null)?.filters;
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [extra, setExtra] = useState<ListingFilters>(() => handoffFilters ?? {});
  const [activeId, setActiveId] = useState<string | null>(null);
  // A place picked from the pickup bar's live suggestions — pans the map
  // there (see ResultsMap's focusPoint) even when it doesn't resolve to one
  // of the app's known cities below.
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const { suggestions, searching: suggestSearching } = useAddressSuggestions(text);
  const { locating, locate } = useMyLocation();

  // Mobile only: which detent the results sheet is pinned to. The floating
  // map/list pill just flips this between `peek` (map dominant) and `half`
  // (list dominant) — dragging the sheet's own handle still reaches `full`.
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>('peek');

  // Filters are per-market, so drop them when the query or the market
  // changes — but not on the very first render, which would otherwise wipe
  // out `handoffFilters` (AiPage's "Show in browse" chip) before it ever
  // painted.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setText(q);
    setExtra({});
    setFocusPoint(null);
  }, [q, country.code]);

  // Click-away closes the suggestions dropdown.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const base = useMemo<ListingFilters>(() => interpretQuery(q), [q]);
  const filters = useMemo<ListingFilters>(() => {
    const merged = { ...base, ...extra };
    // `extra.country` only ever comes from the AI naming a country with no
    // specific city ("one in China") — city-derived and the header default
    // still win in the usual cases where nothing set it explicitly.
    return { ...merged, country: merged.country ?? countryOfCity(merged.city) ?? country.code };
  }, [base, extra, country.code]);

  const { data: listings, isLoading } = useQuery({
    queryKey: ['search', filters],
    queryFn: () => client.listListings(filters),
  });
  const results = listings ?? [];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    setParams(t ? { q: t } : {});
    setSuggestOpen(false);
  }

  // Picking a live suggestion doesn't need a submit round-trip through
  // interpretQuery() at all — it sets the city filter directly (same effect
  // as clicking that city as a "More filters" chip) and focuses the map on
  // the exact point, which covers neighborhoods interpretQuery's keyword
  // matching would never resolve to a known city on its own.
  function pickSuggestion(s: AddressSuggestion) {
    setText(s.label);
    setSuggestOpen(false);
    setFocusPoint({ lat: s.lat, lng: s.lng });
    const matchedCity = citiesFor(country.code).find((c) => s.label.toLowerCase().includes(c.toLowerCase()));
    setExtra((prev) => {
      const next = { ...prev };
      if (matchedCity) next.city = matchedCity;
      else delete next.city;
      return next;
    });
  }

  function useCurrentLocation() {
    locate((p) => {
      setText(`Current location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
      setFocusPoint(p);
      setSuggestOpen(false);
    });
  }

  function togglePatch(patch: ListingFilters) {
    const active = Object.entries(patch).every(
      ([k, v]) => extra[k as keyof ListingFilters] === v,
    );
    setExtra((prev) => {
      const next = { ...prev };
      if (active)
        for (const k of Object.keys(patch))
          delete next[k as keyof ListingFilters];
      else Object.assign(next, patch);
      return next;
    });
  }

  const priceActive = Object.entries(PRICE_FILTER.patch).every(
    ([k, v]) => extra[k as keyof ListingFilters] === v,
  );
  const moreActive =
    MORE_FILTERS.some(({ patch }) =>
      Object.entries(patch).every(
        ([k, v]) => extra[k as keyof ListingFilters] === v,
      ),
    ) || !!extra.city;
  const anyActive = !!extra.category || priceActive || moreActive;

  function rowProps(l: (typeof results)[number]) {
    return {
      key: l.id,
      listing: l,
      layout: 'row' as const,
      isActive: l.id === activeId,
      onHover: (hovering: boolean) => setActiveId(hovering ? l.id : null),
    };
  }

  // A marker tap selects the same way hovering its row does, and (on mobile,
  // where the sheet may be peeked down to just the map) opens the sheet to
  // `half` so the selected row is actually visible rather than merely active
  // behind a collapsed sheet.
  function onMarkerSelect(l: (typeof results)[number]) {
    setActiveId(l.id);
    setSheetDetent((d) => (d === 'peek' ? 'half' : d));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top strip — search + filters. Always in normal flow (not floating
          over the map) so it stays put regardless of the mobile sheet's
          detent or the map/list toggle — "pinned to the top in both states"
          falls out of it simply never moving. */}
      <div className="mx-auto w-full max-w-[1600px] shrink-0 border-b border-[var(--color-line)] px-4 pt-3 pb-3">
        <div ref={suggestBoxRef} className="relative sm:max-w-xl">
          <form onSubmit={onSubmit} className="flex items-stretch gap-2">
            <div className="flex flex-1 items-center overflow-hidden rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] transition-shadow focus-within:border-[var(--color-accent-on)]">
              <Search size={16} className="ml-4 shrink-0 text-[var(--color-content-subtle)]" />
              <input
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSuggestOpen(false);
                }}
                placeholder="Where do you want to pick up?"
                aria-label="Search cars"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)]"
              />
              <Button type="submit" size="sm" pill className="m-1">
                Search
              </Button>
            </div>
          </form>
          {suggestOpen && (
            <div className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={useCurrentLocation}
                disabled={locating}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
              >
                <Navigation className="h-4 w-4 shrink-0 text-[var(--color-accent-on)]" />
                {locating ? 'Finding you…' : 'Use my current location'}
              </button>
              {suggestSearching && (
                <div className="border-t border-[var(--color-line)] px-3 py-2 text-caption text-[var(--color-content-subtle)]">
                  Searching…
                </div>
              )}
              {suggestions.map((s, i) => (
                <button
                  key={`${s.lat},${s.lng},${i}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-start gap-2 border-t border-[var(--color-line)] px-3 py-2 text-left text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-content-subtle)]" />
                  <span className="line-clamp-2">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter chip row — a flat, always-visible scroller rather than the
            old dropdown panels: `Chip`'s selected state (fill+weight, not
            hue) already reads clearly at this density, and a dropdown is one
            more tap standing between a renter and the map on a phone. */}
        <ChipRow className="mt-2.5">
          {CAR_CATEGORIES.map(({ value, label }) => (
            <Chip
              key={value}
              selected={extra.category === value}
              onClick={() =>
                setExtra((p) => ({
                  ...p,
                  category: p.category === value ? undefined : value,
                }))
              }
            >
              {label}
            </Chip>
          ))}
          <Chip selected={priceActive} onClick={() => togglePatch(PRICE_FILTER.patch)}>
            {PRICE_FILTER.label}
          </Chip>
          {MORE_FILTERS.map(({ label, patch }) => (
            <Chip
              key={label}
              selected={Object.entries(patch).every(
                ([k, v]) => extra[k as keyof ListingFilters] === v,
              )}
              onClick={() => togglePatch(patch)}
            >
              {label}
            </Chip>
          ))}
          {citiesFor(country.code).map((c) => (
            <Chip
              key={c}
              selected={extra.city === c}
              onClick={() =>
                setExtra((p) => ({ ...p, city: p.city === c ? undefined : c }))
              }
            >
              {c}
            </Chip>
          ))}
          {anyActive && (
            <button
              type="button"
              onClick={() => setExtra({})}
              className="shrink-0 whitespace-nowrap text-body-sm font-semibold text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:underline"
            >
              Clear all
            </button>
          )}
        </ChipRow>
      </div>

      {/* Results. Desktop keeps the list-left/map-right split. Below `lg` the
          map becomes the full-bleed base layer with the list living in a
          bottom sheet over it — a tab that hides one or the other answers
          only half of "where is this car relative to me" at a time. */}
      <div className="relative min-h-0 flex-1" aria-busy={isLoading || undefined}>
        {isLoading ? (
          <>
            {/* ── Mobile (<lg) ──────────────────────────────────────────── */}
            <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3 lg:hidden">
              {Array.from({ length: 6 }, (_, i) => (
                <ListingRowSkeleton key={i} />
              ))}
            </div>

            {/* ── Desktop (lg+) ─────────────────────────────────────────── */}
            <div className="hidden h-full gap-5 px-4 pb-3 pt-2 lg:flex">
              <div className="h-full w-full max-w-[460px] shrink-0 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] xl:max-w-[560px]">
                <div className="divide-y divide-[var(--color-line)]">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="p-3">
                      <ListingRowSkeleton />
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden min-w-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] lg:block">
                <Skeleton className="h-full w-full rounded-none" />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* ── Mobile (<lg) ──────────────────────────────────────────── */}
            <div className="absolute inset-0 lg:hidden">
              {/* `isolate` scopes Leaflet's own z-index scale (its zoom
                  control sits at 1000) to inside this box — without it, those
                  values leak into the page's shared stacking context and
                  paint over the sheet and the floating toggle above it. */}
              <div className="isolate absolute inset-0">
                <ResultsMap
                  listings={results}
                  activeId={activeId}
                  onHover={setActiveId}
                  onSelect={onMarkerSelect}
                  focusPoint={focusPoint}
                />
              </div>

              <MapListToggle
                showing={sheetDetent === 'peek' ? 'map' : 'list'}
                onToggle={() => setSheetDetent((d) => (d === 'peek' ? 'half' : 'peek'))}
                className={cn('absolute left-1/2 z-30 -translate-x-1/2', TOGGLE_BOTTOM_CLASS[sheetDetent])}
              />

              <Sheet
                detent={sheetDetent}
                onDetentChange={setSheetDetent}
                header={
                  <p className="text-body-sm font-semibold text-[var(--color-content)]">
                    <span className="tabular">{results.length}</span> car{results.length === 1 ? '' : 's'}{' '}
                    {q ? `for “${q}”` : 'available'}
                  </p>
                }
              >
                {results.length > 0 ? (
                  <div className="flex flex-col gap-3 px-4 pb-4">
                    {results.map((l) => (
                      <ListingCard {...rowProps(l)} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 pb-6 pt-2 text-center">
                    <Search size={24} className="text-[var(--color-content-subtle)]" />
                    <p className="font-medium text-[var(--color-content)]">No cars match “{q}”.</p>
                    <p className="text-body-sm text-[var(--color-content-muted)]">
                      Try a broader search or clear the filters.
                    </p>
                  </div>
                )}
              </Sheet>
            </div>

            {/* ── Desktop (lg+) ─────────────────────────────────────────── */}
            <div className="hidden h-full gap-5 px-4 pb-3 pt-2 lg:flex">
              {/* 380px left every title wrapping onto three or four lines —
                  the photo takes 160 of it and a car's name is long ("Hyundai
                  Ioniq 5 — electric in Rubavu"). Turo gives this column ~660px
                  for the same reason. It widens with the viewport rather than
                  taking a fixed share, so the map keeps the space it needs to
                  be a map. */}
              <div className="h-full w-full max-w-[460px] shrink-0 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] xl:max-w-[560px]">
                {results.length > 0 ? (
                  <div className="divide-y divide-[var(--color-line)]">
                    {results.map((l) => (
                      <div key={l.id} className="p-3">
                        <ListingCard {...rowProps(l)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  // The map stays up even with nothing to show on it — losing
                  // it too on top of an empty list read as the page itself
                  // being broken, not just this search coming up empty.
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <Search size={28} className="text-[var(--color-content-subtle)]" />
                    <p className="font-medium text-[var(--color-content)]">No cars match “{q}”.</p>
                    <p className="text-body-sm text-[var(--color-content-muted)]">
                      Try a broader search or clear the filters.
                    </p>
                  </div>
                )}
              </div>
              <div className="isolate hidden min-w-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] lg:block">
                <ResultsMap
                  listings={results}
                  activeId={activeId}
                  onHover={setActiveId}
                  onSelect={onMarkerSelect}
                  focusPoint={focusPoint}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
