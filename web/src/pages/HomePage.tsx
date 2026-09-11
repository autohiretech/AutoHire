import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CarFront,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Leaf,
  PlusCircle,
  ShieldCheck,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { mergeAiFilters } from '@/lib/aiFilters';
import { loadHomeLocation, subscribeHomeLocation } from '@/lib/homeLocation';
import { useT } from '@/lib/i18n';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES } from '@/lib/categories';
import { Badge, Chip, ChipRow } from '@/components/ui';
import { SearchBar } from '@/components/research/SearchBar';
import { ListingCardSkeleton } from '@/components/skeletons';
import { ListingCard } from '@/components/ListingCard';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { listingHeadlinePrice } from '@/lib/pricing';
import { BrowseTabs } from '@/components/marketplace/BrowseTabs';
import { useAppMode } from '@/lib/appMode';
import { useCountry } from '@/lib/country';
import { citiesFor } from '@/lib/cities';

/**
 * A page and a half of scrolling before the pager appears.
 *
 * Was 24, which at four cards a row ran out after six rows — short enough that
 * a catalogue of 500 cars read as a small one. Larger cards mean fewer per row,
 * so the count goes up to keep the page feeling deep rather than paged.
 */
const PAGE_SIZE = 36;

/**
 * Listing grid: 2 / 3 fixed columns. A short final row leaves empty cells rather
 * than stretching its cards — under flex `grow` a row of one card blew up to full
 * width and no longer matched the cards above it.
 *
 * Three across at the widest, not four.
 *
 * A fourth column buys one more car per row and costs every car the photo that
 * sells it — at four the image is small enough that a RAV4 and a Land Cruiser
 * look alike. Three keeps the picture large enough to tell them apart, and the
 * grid runs longer instead of denser.
 */
const CARD_GRID = 'grid grid-cols-2 gap-5 lg:grid-cols-3';

/**
 * The browse state we remember (per session) so clicking into a car and
 * coming back lands on the same page/filters instead of resetting to page 1.
 * Pairs with <ScrollMemory> which restores the scroll offset.
 */
const BROWSE_KEY = 'autohire.home-browse';
type BrowseState = { filters: ListingFilters; topRanked: boolean };
function loadBrowse(): Partial<BrowseState> {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(BROWSE_KEY) || '{}') as Partial<BrowseState>;
  } catch {
    return {};
  }
}

/**
 * Home: a compact hero (search over a photo, not a full-bleed banner), a
 * category chip row, a few horizontal rails grouped by a real reason
 * ("Electric cars in Rwanda", "Popular in Kigali"), then the full filterable
 * grid — the Turo/Getaround pattern instead of the previous Alibaba-style
 * console (tab bar + sidebar + showcase grid). Everything is wired to the
 * same real AutoHire data — search, AI search, categories, listings — this is
 * a re-layout, not new plumbing.
 */
export function HomePage() {
  // Restore where the user was browsing (read once on mount).
  const [savedBrowse] = useState(loadBrowse);
  const t = useT();
  const [filters, setFilters] = useState<ListingFilters>(() => {
    // `savedBrowse.filters` is `undefined` only for a genuinely fresh
    // session (nothing was ever written to `BROWSE_KEY`) — a session that
    // exists but has empty filters (the renter hit "Clear filters" and came
    // back) is `{}`, not `undefined`, and must NOT be overridden here, or
    // an explicit clear would silently un-clear itself on the next load.
    // Only the true first case gets "around me" as its starting point, and
    // only when the renter chose to save one (Account → Your location) — no
    // fresh GPS prompt fires just from loading this page.
    if (savedBrowse.filters !== undefined) return savedBrowse.filters;
    const home = loadHomeLocation();
    return home ? { nearLat: home.lat, nearLng: home.lng } : {};
  });
  const [topRanked, setTopRanked] = useState(savedBrowse.topRanked ?? false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { mode } = useAppMode();
  const { country, setCountry } = useCountry();

  // Every pull is scoped to the selected market — switching country in the
  // header refilters the catalogue (and reprices via the display currency).
  const scoped = { ...filters, country: country.code };

  // Stable, market-scoped pull that feeds the featured slideshow + the hero photo.
  const { data: featured } = useQuery({
    queryKey: ['listings', 'featured', country.code],
    queryFn: () => client.listListings({ country: country.code }),
  });
  // Filtered, infinitely-paginated pull that drives the recommended grid.
  // Changing `scoped` (filters or market) is a different query key entirely,
  // so react-query starts a fresh page 0 on its own — no manual "reset to
  // page 1 on filter change" effect needed, unlike the discrete pager this
  // replaced.
  const {
    data: infiniteData,
    isLoading,
    isError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['listings-page', scoped],
    queryFn: ({ pageParam }) => client.listListingsPage(scoped, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length * PAGE_SIZE < lastPage.total ? allPages.length : undefined,
  });

  // The two rails below the chip row: electric cars market-wide, and the top
  // two cities with inventory in this market. Each is its own small query so
  // a rail with nothing in it (e.g. no electric cars yet) just renders
  // nothing rather than an empty shelf.
  const [cityA, cityB] = citiesFor(country.code);
  const { data: electricCars, isLoading: electricLoading } = useQuery({
    queryKey: ['listings-rail-electric', country.code],
    queryFn: () => client.listListings({ country: country.code, fuel: 'electric' }),
  });
  const { data: cityACars, isLoading: cityALoading } = useQuery({
    queryKey: ['listings-rail-city', country.code, cityA],
    queryFn: () => client.listListings({ country: country.code, city: cityA }),
    enabled: !!cityA,
  });
  const { data: cityBCars, isLoading: cityBLoading } = useQuery({
    queryKey: ['listings-rail-city', country.code, cityB],
    queryFn: () => client.listListings({ country: country.code, city: cityB }),
    enabled: !!cityB,
  });

  // A city only exists in one market, so a city left over from the previous country
  // (or restored from a past session) would filter the grid down to nothing. Drop it.
  useEffect(() => {
    setFilters((f) =>
      f.city && !citiesFor(country.code).includes(f.city) ? { ...f, city: undefined } : f,
    );
  }, [country.code]);

  // Remember the browse state so returning lands here (see <ScrollMemory> too).
  // Which page a renter had scrolled to isn't part of this — an infinite
  // list doesn't have a "page they were on" the way a pager did, and
  // <ScrollMemory> already restores the scroll offset itself.
  useEffect(() => {
    try {
      sessionStorage.setItem(BROWSE_KEY, JSON.stringify({ filters, topRanked }));
    } catch {
      /* storage full/disabled — non-critical */
    }
  }, [filters, topRanked]);

  // Fetches the next page ~800px before the sentinel actually enters view, so
  // the next batch is rendered before a renter scrolling fast ever sees the
  // bottom edge — a fetch triggered only once they're already there would
  // show a beat of empty space first.
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // The location banner under the header (and Account → Your location) can
  // set a coordinate while this page is already on screen. Reading it once in
  // `useState` above only ever covered the *next* visit — so a renter who
  // tapped "Use my location" got their country and their currency, and a grid
  // still ordered by rating, until they came back. This applies it where they
  // are, when they ask.
  useEffect(
    () =>
      subscribeHomeLocation((home) =>
        setFilters((prev) => {
          const next = { ...prev };
          if (home) {
            next.nearLat = home.lat;
            next.nearLng = home.lng;
            // Same reason as `onPointMatch` below: a coordinate answers
            // "where" more precisely than a city, so it replaces one.
            delete next.city;
          } else {
            delete next.nearLat;
            delete next.nearLng;
          }
          return next;
        }),
      ),
    [],
  );

  function setFilter<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function scrollToResults() {
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The server already filtered and ranked — flatten every page fetched so far.
  const results = infiniteData?.pages.flatMap((p) => p.items) ?? [];
  const total = infiniteData?.pages[0]?.total ?? 0;
  const heroPhoto = featured?.[0]?.photos?.[0];
  // Whole calendar days in the picked trip — same rounding CarDetailPage's
  // own night-count already uses, for one consistent answer to "how many
  // days is this" app-wide. Undefined (not 0) when no dates are picked, so
  // ListingCard's `showTotal` check (`!!tripUnits`) stays false rather than
  // rendering a "0 total" line.
  const tripDays =
    filters.startDate && filters.endDate
      ? Math.max(
          1,
          Math.round(
            (new Date(filters.endDate).getTime() - new Date(filters.startDate).getTime()) / 86_400_000,
          ),
        )
      : undefined;

  return (
    <div className="bg-[var(--color-surface)]">
      {/* ── Compact hero: a search bar over a photo, not a full-bleed banner ──
          Turo's hero is one band, not the whole viewport — a phone needs to see
          the category chips and the first rail without scrolling past a giant
          panel. The photo is the top-rated car in this market, so the colour
          comes from real inventory rather than a tinted green panel. */}
      {/* Clips sideways only. `overflow-hidden` here was cutting the search
          bar's own popovers off at the hero's bottom edge — the location
          suggestions and the date calendar are taller than the band they
          drop out of, so the renter saw a panel guillotined mid-list with
          the actual results below the cut. `overflow-x: clip` keeps the
          no-sideways-scroll guarantee on phones without that cost:
          unlike `hidden`, it does not force the other axis into a
          clipping box, so `overflow-y: visible` is genuinely honoured.
          The photo below needs no vertical clipping of its own — it is
          `absolute inset-0`, already bounded by this section's box. */}
      <section className="relative overflow-x-clip overflow-y-visible bg-[var(--color-surface-inverse)]">
        {heroPhoto && (
          <Img
            src={heroPhoto}
            alt=""
            loading="eager"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {/* Scrim for legibility over an unknown photo — fixed, not theme-aware,
            same reasoning as Badge's `overlay` tone: the ground here is a
            photograph, not a surface token. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/10" />

        <div className="relative mx-auto max-w-[1500px] px-4 py-6 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BrowseTabs />
            {mode === 'host' ? (
              <Link
                to="/cars/new"
                className="flex shrink-0 items-center gap-1.5 text-body-sm font-semibold text-white hover:text-white/80"
              >
                <PlusCircle size={16} /> List your car
              </Link>
            ) : (
              <Link
                to="/account"
                className="flex shrink-0 items-center gap-1.5 text-body-sm font-semibold text-white hover:text-white/80"
              >
                <PlusCircle size={16} /> Become a host
              </Link>
            )}
          </div>

          <h1 className="mt-5 max-w-lg text-h3 text-white sm:text-h2">
            {t('home.heroTitle', { country: country.name })}
          </h1>

          {/* The compound Where/From/Until bar is the same one /ai's own
              field uses (see SearchBar), so the two never drift apart. It
              opens in its own default, plain Search mode — no glow, no
              floating "Ask AI" badge implying the whole thing is model-driven
              when the renter hasn't asked for that. SearchBar carries its own
              Search/Ask AI toggle now, which is the honest, opt-in version of
              what the glow used to claim ambiently. "Where" matching a known
              city is the one part of Search mode that filters the grid below
              directly, with no model call anywhere in that path. */}
          <div className="relative mt-4 w-full max-w-2xl">
            <div className="relative">
              <SearchBar
                onSubmit={(input) => {
                  // A city match, a date range, or a resolved coordinate
                  // picked here already filters this page's own grid (below)
                  // live — carry them into /ai's stored filters so they're
                  // there the instant it mounts, instead of the renter's pick
                  // vanishing the moment they land on a page with its own,
                  // separately-empty state.
                  //
                  // The coordinate is the one that used to be dropped here,
                  // and it was the worst one to lose: /ai would mount knowing
                  // only the *city* the renter was in, having been handed —
                  // and then having discarded — exactly where in it they were
                  // standing. Both travel now; Home has already applied the
                  // rule that a resolved point clears a derived city, so
                  // whatever survives here is what the renter meant.
                  mergeAiFilters({
                    city: filters.city,
                    startDate: filters.startDate,
                    endDate: filters.endDate,
                    nearLat: filters.nearLat,
                    nearLng: filters.nearLng,
                  });
                  navigate(input.message ? `/ai?ask=${encodeURIComponent(input.message)}` : '/ai');
                }}
                // Search mode goes to /search — the manual results page,
                // which is the one with the map — mirroring how Ask AI mode
                // goes to /ai. Scrolling to the grid below was not enough:
                // the grid has no map, and "search" on a marketplace means
                // "show me the results page", not "move down the page a bit".
                // With nothing typed there is nothing to send them to, so it
                // falls back to the grid they already have.
                //
                // The coordinate rides along in the URL when there is one, so
                // /search opens centred on where the renter actually is and
                // ranked by distance from it (`nearLat`/`nearLng`, migration
                // 075). Sending only the address label meant /search had to
                // reverse-engineer the place out of a string — which is how
                // "Gasabo District, City of Kigali, Rwanda" ended up as
                // keywords no listing could match.
                onSearch={({ query, point }) => {
                  if (!query) {
                    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return;
                  }
                  const next = new URLSearchParams({ q: query });
                  if (point) {
                    next.set('lat', String(point.lat));
                    next.set('lng', String(point.lng));
                  }
                  navigate(`/search?${next.toString()}`);
                }}
                onCityMatch={(city) => setFilter('city', city)}
                // A resolved coordinate replaces the city rather than joining
                // it: `city` is a hard `.eq()`, so keeping both would drop the
                // nearest cars whenever the renter is near a city boundary,
                // while `nearLat`/`nearLng` only ranks (migration 075).
                onPointMatch={(point) =>
                  setFilters((prev) => {
                    const next = { ...prev };
                    if (point) {
                      next.nearLat = point.lat;
                      next.nearLng = point.lng;
                      delete next.city;
                    } else {
                      delete next.nearLat;
                      delete next.nearLng;
                    }
                    return next;
                  })
                }
                onCountryMatch={(code) => setCountry(code)}
                onDateRangeChange={(r) =>
                  setFilters((prev) => {
                    // Deleted, not set to `undefined` — `filters` feeds an
                    // `Object.keys(filters).length > 0` check below (the
                    // "Clear filters" button's visibility), and an `undefined`
                    // own-property still counts as a key there.
                    const next = { ...prev };
                    if (r.start && r.end) {
                      next.startDate = r.start;
                      next.endDate = r.end;
                    } else {
                      delete next.startDate;
                      delete next.endDate;
                    }
                    return next;
                  })
                }
                placeholder="Anything else? SUV, under 150k, automatic…"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Badge tone="overlay">
              <Leaf size={12} /> 90% electric, hybrid &amp; ecological
            </Badge>
            <span className="flex items-center gap-1 text-caption text-white/80">
              <ShieldCheck size={13} /> All hosts verified
            </span>
          </div>
        </div>
      </section>

      <div ref={resultsRef} className="mx-auto max-w-[1500px] scroll-mt-4 px-4 py-6">
        {/* Category chip row — directly under the search, and the one filter
            control every breakpoint shares. Previously this was a desktop
            accordion sidebar *and* a separate mobile rail carrying the same
            list twice; one scrolling row replaces both. */}
        <ChipRow className="-mx-4 px-4 pb-1">
          <Chip
            selected={!filters.category}
            onClick={() => {
              setFilter('category', undefined);
              scrollToResults();
            }}
          >
            <LayoutGrid size={14} /> All
          </Chip>
          {CAR_CATEGORIES.map(({ value, label, icon: Icon }) => {
            const active = filters.category === value;
            return (
              <Chip
                key={value}
                selected={active}
                onClick={() => {
                  setFilter('category', active ? undefined : value);
                  scrollToResults();
                }}
              >
                <Icon size={14} /> {label}
              </Chip>
            );
          })}
        </ChipRow>

        {/* Rails — cars grouped by a reason, Turo-style, scrolling
            horizontally rather than wrapping into another grid. */}
        <div className="mt-2">
          <ListingRail
            title={`Electric cars in ${country.name}`}
            subtitle={t('home.electricSubtitle')}
            listings={electricCars}
            isLoading={electricLoading}
          />
          {cityA && (
            <ListingRail
              title={`Popular in ${cityA}`}
              subtitle={t('home.topRatedNearYou')}
              listings={cityACars}
              isLoading={cityALoading}
            />
          )}
          {cityB && (
            <ListingRail
              title={`Popular in ${cityB}`}
              subtitle={t('home.topRatedNearYou')}
              listings={cityBCars}
              isLoading={cityBLoading}
            />
          )}
        </div>

        {/* Featured slideshow — a rotating BaT-style hero (auto every 3s) ─── */}
        {(featured?.length ?? 0) > 0 && (
          <div className="mt-2">
            <h2 className="mb-3 text-h3">{t('home.featured')}</h2>
            <FeaturedSlideshow listings={featured ?? []} />
          </div>
        )}

        {/* Full results grid — the categories rail + electric/top-ranked
            chips filter this. */}
        <section className="mt-8 min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h3">{topRanked ? 'Top ranked cars' : t('home.recommended')}</h2>
            <ChipRow>
              <Chip
                selected={filters.fuel === 'electric'}
                onClick={() => setFilter('fuel', filters.fuel === 'electric' ? undefined : 'electric')}
              >
                <Zap size={14} /> Electric
              </Chip>
              <Chip selected={topRanked} onClick={() => setTopRanked((v) => !v)}>
                <TrendingUp size={14} /> Top ranked
              </Chip>
            </ChipRow>
          </div>

          {isLoading ? (
            <div className={CARD_GRID} aria-busy="true" aria-label="Loading cars">
              {Array.from({ length: 9 }, (_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>
          ) : results.length > 0 ? (
            <>
              <div className={CARD_GRID}>
                {results.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} tripUnits={tripDays} />
                ))}
                {isFetchingNextPage &&
                  Array.from({ length: 3 }, (_, i) => <ListingCardSkeleton key={`more-${i}`} />)}
              </div>
              <p className="tabular mt-6 text-center text-body-sm text-[var(--color-content-muted)]">
                Showing {results.length} of {total} cars
              </p>
              {/* No visible content — an IntersectionObserver trigger, not a
                  "load more" button. Sits below the grid so it enters the
                  viewport (and fires the fetch) while the renter is still
                  scrolling through the current batch, per the effect above. */}
              {hasNextPage && <div ref={loadMoreRef} aria-hidden className="h-px" />}
            </>
          ) : isError ? (
            // A failed request must never look like "we searched and there's
            // nothing" — those are different facts, and only one of them is
            // this renter's problem to fix by changing filters. Caught live:
            // picking dates before the availability RPC existed 404'd every
            // time, and without this branch it silently rendered as "No cars
            // match your search. Clear filters" — true-looking and wrong.
            <EmptyState
              label="Couldn't load cars right now. Please try again."
              action={
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="text-body-sm font-semibold text-[var(--color-accent-on)] hover:underline"
                >
                  Retry
                </button>
              }
            />
          ) : (
            <EmptyState
              label="No cars match your search."
              action={
                Object.keys(filters).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilters({})}
                    className="text-body-sm font-semibold text-[var(--color-accent-on)] hover:underline"
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * A horizontally scrolling shelf of cars grouped by one concrete reason
 * ("Electric cars in Rwanda") — the Turo/Getaround row pattern. Renders
 * nothing once loaded with zero matches, rather than a heading over an empty
 * shelf.
 */
function ListingRail({
  title,
  subtitle,
  listings,
  isLoading,
}: {
  title: string;
  subtitle?: string;
  listings?: Listing[];
  isLoading: boolean;
}) {
  if (!isLoading && (listings?.length ?? 0) === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-h3">{title}</h2>
      {subtitle && (
        <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">{subtitle}</p>
      )}
      {/* `relative` is load-bearing — it is what stops the whole page scrolling
          sideways, and it is not obvious enough to survive a tidy-up unmarked.
          `overflow-x-auto` only clips a descendant whose containing block is
          inside this element. The `sr-only` spans in the cards are
          `position: absolute` with nothing positioned between them and
          `<body>`, so their containing block was the body and this scroller
          never clipped them: twenty-one of them sat at their unclipped
          position, ~2000px off to the right, and the document grew to reach
          them. The page scrolled into a screen and a half of empty space and
          the rails themselves looked perfectly normal, which is why this took
          measuring rather than reading. Making the rail the containing block
          brings them back inside the clip. */}
      {isLoading ? (
        <div
          className="relative -mx-4 mt-3 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-busy="true"
          aria-label="Loading cars"
        >
          {Array.from({ length: 4 }, (_, i) => (
            // Bumped from 240px (`sm:w-60`) — six-plus cards fit across a
            // wide screen at that width, which read as cramped rather than a
            // deliberate row. 288–320px is four to five per row instead.
            // Mobile widens to 75% so one card reads clearly with a peek of
            // the next, rather than two nearly fitting at 68%.
            <div key={i} className="w-[75%] shrink-0 sm:w-72 md:w-80">
              <ListingCardSkeleton />
            </div>
          ))}
        </div>
      ) : (
        <div className="relative -mx-4 mt-3 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(listings ?? []).slice(0, 12).map((listing) => (
            <div key={listing.id} className="w-[75%] shrink-0 sm:w-72 md:w-80">
              <ListingCard listing={listing} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Featured slideshow — a big BaT-style hero that auto-rotates through a handful
 * of cars every 3 seconds (pauses on hover). The current car fills the left; the
 * other featured cars are clickable thumbnails on the right. Prev/next arrows and
 * progress dots let you drive it manually.
 */
function FeaturedSlideshow({ listings }: { listings: Listing[] }) {
  const items = listings.slice(0, 5);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  // Restart at the first car whenever the set changes (e.g. switching country).
  useEffect(() => {
    setI(0);
  }, [items.length, items[0]?.id]);

  // Auto-advance every 3s.
  useEffect(() => {
    if (paused || items.length <= 1) return;
    const t = setInterval(() => setI((v) => (v + 1) % items.length), 3000);
    return () => clearInterval(t);
  }, [paused, items.length]);

  if (items.length === 0) return null;
  const car = items[i] ?? items[0];
  const others = items.filter((_, idx) => idx !== i).slice(0, 4);
  const go = (d: number) => setI((v) => (v + d + items.length) % items.length);
  const subtitle = `${car.year} · ${cap(car.transmission)} · ${cap(car.fuel)} · ${car.seats} seats`;

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)]"
    >
      <div className="grid grid-cols-1 gap-1 md:grid-cols-[1.7fr_1fr]">
        {/* Hero (current car) */}
        <div className="relative">
          <Link to={`/cars/${car.id}`} className="block">
            <Img
              key={car.id}
              src={car.photos[0]}
              alt={car.title}
              loading="eager"
              className="h-64 w-full object-cover sm:h-80 md:h-[22rem]"
            />
          </Link>
          {/* Fixed dark scrim + strip, not theme tokens — this sits over an
              unknown photo, same reasoning as Badge's `overlay` tone. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/45" />
          <span className="absolute left-4 top-4 rounded bg-black/85 px-2.5 py-1 text-caption font-bold uppercase tracking-wide text-white">
            Featured
          </span>
          <div className="absolute right-4 top-3 max-w-[56%] text-right text-white sm:max-w-[75%]">
            <p className="line-clamp-1 text-body-lg font-bold drop-shadow">{car.title}</p>
            <p className="line-clamp-1 text-body-sm text-white/85 drop-shadow">{subtitle}</p>
          </div>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white">
            <span className="tabular rounded-[var(--radius-control)] bg-black/55 px-2.5 py-1 text-body-sm font-semibold backdrop-blur-sm">
              <Price amount={listingHeadlinePrice(car).amount} currency={car.priceCurrency} />
              <span className="font-normal text-white/70"> /{listingHeadlinePrice(car).unit}</span>
            </span>
            {car.ratingCount > 0 && (
              <span className="tabular flex items-center gap-1 rounded-[var(--radius-control)] bg-black/55 px-2 py-1 text-body-sm backdrop-blur-sm">
                <Star size={13} className="fill-brand-400 text-brand-400" /> {car.ratingAvg.toFixed(1)}
              </span>
            )}
          </div>
          {items.length > 1 && (
            <div className="absolute bottom-4 right-4 flex gap-1.5">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous car"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next car"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Thumbnails — the other featured cars (desktop only). Photos are
            absolutely positioned so they fill a tile without sizing it: an
            in-flow `h-full` <img> falls back to its natural aspect ratio in a
            grid row, which grew this column past the hero's fixed height on
            wide screens and left a blank band under the hero photo. Same fix
            as CarDetailPage's gallery. */}
        <div className="hidden min-h-0 grid-cols-2 grid-rows-2 gap-1 md:grid">
          {others.map((o) => {
            const idx = items.indexOf(o);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setI(idx)}
                className="group relative min-h-0 overflow-hidden"
                aria-label={`Show ${o.title}`}
              >
                <Img
                  src={o.photos[0]}
                  alt={o.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-left text-caption font-medium text-white">
                  {o.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Progress dots — fixed dark strip, same photo-context exemption as
          the scrim above. */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 bg-black py-2">
          {items.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setI(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={cn(
                'h-1.5 rounded-full transition-all',
                idx === i ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-16 text-center">
      <CarFront size={30} className="text-[var(--color-content-subtle)]" />
      <p className="text-body font-medium text-[var(--color-content-muted)]">{label}</p>
      {action}
    </div>
  );
}
