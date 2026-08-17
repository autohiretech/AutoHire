import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Navigation, Search } from 'lucide-react';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { CAR_CATEGORIES } from '@/lib/categories';
import { interpretQuery } from '@/lib/demoAi';
import { ResultsMap } from '@/components/map/ResultsMap';
import { Spinner } from '@/components/ui';
import { useCountry } from '@/lib/country';
import { citiesFor, countryOfCity } from '@/lib/cities';
import { useAiAssistantActions, useAiAssistantSource } from '@/lib/aiAssistantContext';
import { Chip, FilterPill, MORE_FILTERS, PRICE_FILTER, type PanelId } from '@/components/marketplace/SearchFilters';
import { ListRow } from '@/components/marketplace/ListRow';
import { useAddressSuggestions, type AddressSuggestion } from '@/lib/geocoding';

/**
 * Search results page — Getaround's own layout: a slim filter-pill row, a
 * narrow result list, and a map that takes most of the page. The Gemini bot
 * is an addition on top of this, not a replacement for it: a floating
 * bubble that writes into the same filter state these pills use, so
 * whichever one touched it last drives the same list + map underneath.
 */
export function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const { country } = useCountry();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [extra, setExtra] = useState<ListingFilters>({});
  const [openPanel, setOpenPanel] = useState<PanelId>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Cars the assistant's last filter turn actually matched — highlighted on
  // the map/list so a chat reply isn't the only place they show up.
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  // A place picked from the pickup bar's live suggestions — pans the map
  // there (see ResultsMap's focusPoint) even when it doesn't resolve to one
  // of the app's known cities below.
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const { suggestions, searching: suggestSearching } = useAddressSuggestions(text);

  // Filters are per-market, so drop them when the query or the market changes.
  useEffect(() => {
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

  // Arriving via Home's "Ask AI" bar (?bot=1&ask=...) means the AI's answer
  // is what should drive this page's first paint — not the plain, unfiltered
  // "every car in the market" catalogue this page would otherwise show while
  // that request is still in flight. That flash read as the traditional
  // search "jumping in" ahead of the AI. `aiPending` holds the real list/map
  // back until either the AI actually sets filters (below) or a bounded
  // timeout passes (so a purely conversational reply, with no filter call,
  // doesn't leave the page stuck waiting forever).
  const [aiPending, setAiPending] = useState(
    () => params.get('bot') === '1' && !!params.get('ask'),
  );
  useEffect(() => {
    if (!aiPending) return;
    const t = setTimeout(() => setAiPending(false), 12000);
    return () => clearTimeout(t);
  }, [aiPending]);

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

  // Publishes the current result set to the global AI assistant (mounted in
  // AppLayout) — this is what lets "book the second one" resolve, and what
  // makes a filter change from the assistant update this page's own list +
  // map in place instead of falling back to a /search navigation.
  useAiAssistantSource(results, {
    loading: isLoading,
    filters,
    onFilters: (f, clear) => {
      setAiPending(false);
      setExtra((prev) => {
        const next = { ...prev, ...f };
        // A field merely absent from `f` means "unchanged" — only listed in
        // `clear` does it actually get removed. Without this, a renter
        // saying "not an suv" could never undo an earlier category filter:
        // the old value would just keep winning the merge every turn.
        for (const key of clear ?? []) delete next[key];
        return next;
      });
    },
    onHighlight: setHighlightIds,
  });
  // Actions-only, deliberately — subscribing to the combined context here
  // would re-render this page on every contextListings/highlight change this
  // very page causes via useAiAssistantSource above, which is the same
  // feedback shape that caused CarDetailPage's infinite loop.
  const { selectForBooking } = useAiAssistantActions();

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
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setText(`Current location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
        setFocusPoint(p);
        setSuggestOpen(false);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
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

  const typeActive = !!extra.category;
  const priceActive = Object.entries(PRICE_FILTER.patch).every(
    ([k, v]) => extra[k as keyof ListingFilters] === v,
  );
  const moreActive =
    MORE_FILTERS.some(({ patch }) =>
      Object.entries(patch).every(
        ([k, v]) => extra[k as keyof ListingFilters] === v,
      ),
    ) || !!extra.city;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top strip — search + filters. Kept to a minimal fixed height so the
          list + map below start immediately, not partway down a long page. */}
      <div className="mx-auto w-full max-w-[1600px] shrink-0 px-4 pt-3">
        <div ref={suggestBoxRef} className="relative sm:max-w-xl">
          <form onSubmit={onSubmit} className="flex items-stretch gap-2">
            <div className="flex flex-1 items-center overflow-hidden rounded-full border-2 border-brand-500 bg-white shadow-sm transition-shadow focus-within:border-brand-600 focus-within:shadow-md">
              <Search size={16} className="ml-4 shrink-0 text-ink-400" />
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
                className="min-w-0 flex-1 px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400"
              />
              <button
                type="submit"
                className="m-1 flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:brightness-95 hover:shadow"
              >
                Search
              </button>
            </div>
          </form>
          {suggestOpen && (
            <div className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-200 bg-white shadow-lg">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={useCurrentLocation}
                disabled={locating}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-60"
              >
                <Navigation className="h-4 w-4 shrink-0 text-brand-600" />
                {locating ? 'Finding you…' : 'Use my current location'}
              </button>
              {suggestSearching && (
                <div className="border-t border-ink-100 px-3 py-2 text-xs text-ink-400">Searching…</div>
              )}
              {suggestions.map((s, i) => (
                <button
                  key={`${s.lat},${s.lng},${i}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-start gap-2 border-t border-ink-100 px-3 py-2 text-left text-sm hover:bg-ink-50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <span className="line-clamp-2">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter pill row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <FilterPill
            label="Vehicle type"
            active={typeActive}
            open={openPanel === 'type'}
            onToggle={() => setOpenPanel((p) => (p === 'type' ? null : 'type'))}
          >
            <div className="flex w-64 flex-wrap gap-2 p-3">
              {CAR_CATEGORIES.map(({ value, label }) => (
                <Chip
                  key={value}
                  active={extra.category === value}
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
            </div>
          </FilterPill>

          <FilterPill
            label="Price"
            active={priceActive}
            open={openPanel === 'price'}
            onToggle={() =>
              setOpenPanel((p) => (p === 'price' ? null : 'price'))
            }
          >
            <div className="w-56 p-3">
              <Chip
                active={priceActive}
                onClick={() => togglePatch(PRICE_FILTER.patch)}
              >
                {PRICE_FILTER.label}
              </Chip>
            </div>
          </FilterPill>

          <FilterPill
            label="More filters"
            active={moreActive}
            open={openPanel === 'more'}
            onToggle={() => setOpenPanel((p) => (p === 'more' ? null : 'more'))}
          >
            <div className="w-72 space-y-3 p-3">
              <div className="flex flex-wrap gap-2">
                {MORE_FILTERS.map(({ label, patch }) => (
                  <Chip
                    key={label}
                    active={Object.entries(patch).every(
                      ([k, v]) => extra[k as keyof ListingFilters] === v,
                    )}
                    onClick={() => togglePatch(patch)}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
              <div className="border-t border-ink-100 pt-3">
                <p className="mb-2 text-xs font-medium text-ink-500">City</p>
                <div className="flex flex-wrap gap-2">
                  {citiesFor(country.code).map((c) => (
                    <Chip
                      key={c}
                      active={extra.city === c}
                      onClick={() =>
                        setExtra((p) => ({
                          ...p,
                          city: p.city === c ? undefined : c,
                        }))
                      }
                    >
                      {c}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </FilterPill>

          {(typeActive || priceActive || moreActive) && (
            <button
              type="button"
              onClick={() => setExtra({})}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Results — narrow list on the left (scrolls in place), map filling the
          rest of the viewport on the right. The whole thing fits under the top
          strip; only the list itself scrolls, the page never does. */}
      <div className="min-h-0 flex-1 px-4 pb-3 pt-2">
        {isLoading || aiPending ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Spinner size={28} />
            {aiPending && <p className="text-sm text-ink-500">Asking the assistant…</p>}
          </div>
        ) : (
          <div className="flex h-full gap-5">
            <div className="h-full w-full max-w-[380px] shrink-0 overflow-y-auto rounded-2xl border border-ink-100 bg-white shadow-card">
              {results.length > 0 ? (
                <div className="divide-y divide-ink-100">
                  {results.map((l) => (
                    <ListRow
                      key={l.id}
                      listing={l}
                      isActive={l.id === activeId || highlightIds.includes(l.id)}
                      onHover={(hovering) => setActiveId(hovering ? l.id : null)}
                    />
                  ))}
                </div>
              ) : (
                // The map stays up even with nothing to show on it — losing
                // it too on top of an empty list read as the page itself
                // being broken, not just this search coming up empty.
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <Search size={28} className="text-ink-300" />
                  <p className="font-medium text-ink-700">No cars match “{q}”.</p>
                  <p className="text-sm text-ink-500">
                    Try a broader search or clear the filters.
                  </p>
                </div>
              )}
            </div>
            {/* `isolate` scopes Leaflet's own z-index scale (its zoom control
                sits at 1000) to inside this box — without it, those values
                leak into the page's shared stacking context and paint over
                the header, search bar, and the AI chat bubble below. */}
            <div className="isolate hidden min-w-0 flex-1 overflow-hidden rounded-2xl border border-ink-100 shadow-card lg:block">
              <ResultsMap
                listings={results}
                activeId={activeId}
                onHover={setActiveId}
                highlightIds={highlightIds}
                onSelect={selectForBooking}
                focusPoint={focusPoint}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

