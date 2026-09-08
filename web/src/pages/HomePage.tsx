import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CarFront,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Leaf,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES } from '@/lib/categories';
import { Badge, Chip, ChipRow } from '@/components/ui';
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
type BrowseState = { filters: ListingFilters; topRanked: boolean; page: number };
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
  const [filters, setFilters] = useState<ListingFilters>(savedBrowse.filters ?? {});
  const [topRanked, setTopRanked] = useState(savedBrowse.topRanked ?? false);
  const [page, setPage] = useState(savedBrowse.page ?? 0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { mode } = useAppMode();
  const { country } = useCountry();

  // Every pull is scoped to the selected market — switching country in the
  // header refilters the catalogue (and reprices via the display currency).
  const scoped = { ...filters, country: country.code };

  // Stable, market-scoped pull that feeds the featured slideshow + the hero photo.
  const { data: featured } = useQuery({
    queryKey: ['listings', 'featured', country.code],
    queryFn: () => client.listListings({ country: country.code }),
  });
  // Filtered, PAGINATED pull that drives the recommended grid — one page at a
  // time (with the total count) instead of every car at once.
  const { data: pageData, isLoading } = useQuery({
    queryKey: ['listings-page', scoped, page],
    queryFn: () => client.listListingsPage(scoped, page, PAGE_SIZE),
    placeholderData: keepPreviousData, // keep the old page visible while the next loads
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

  // Reset to page 1 whenever the filters, market, or ranking change — but NOT on
  // the initial mount, so a restored page survives coming back from a car.
  const skipPageReset = useRef(true);
  useEffect(() => {
    if (skipPageReset.current) {
      skipPageReset.current = false;
      return;
    }
    setPage(0);
  }, [country.code, topRanked, JSON.stringify(filters)]);

  // Remember the browse state so returning lands here (see <ScrollMemory> too).
  useEffect(() => {
    try {
      sessionStorage.setItem(BROWSE_KEY, JSON.stringify({ filters, topRanked, page }));
    } catch {
      /* storage full/disabled — non-critical */
    }
  }, [filters, topRanked, page]);

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

  // The server already filtered, ranked and paginated — just render the page.
  const results = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const heroPhoto = featured?.[0]?.photos?.[0];

  return (
    <div className="bg-[var(--color-surface)]">
      {/* ── Compact hero: a search bar over a photo, not a full-bleed banner ──
          Turo's hero is one band, not the whole viewport — a phone needs to see
          the category chips and the first rail without scrolling past a giant
          panel. The photo is the top-rated car in this market, so the colour
          comes from real inventory rather than a tinted green panel. */}
      <section className="relative overflow-hidden overflow-x-clip bg-[var(--color-surface-inverse)]">
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
            Find your next ride in {country.name}
          </h1>

          {/* Styled to read as a research/ask bar, not a CTA button — car
              shopping is a research task, not a booking, and a solid filled
              pill invited "click to book" rather than "ask me something".
              Still no typing here: it's one click target, and the assistant
              asks whatever it needs once the panel is open. A soft pulsing
              glow behind the (input-shaped) bar keeps it reading as the
              "alive", AI-driven entry point rather than a plain field. */}
          <div className="relative mt-4 w-full max-w-2xl">
            <div
              aria-hidden
              className="animate-ai-glow absolute -inset-1.5 rounded-full bg-gradient-to-r from-brand-400 via-brand-200 to-brand-500 opacity-40 blur-lg"
            />
            <button
              type="button"
              onClick={() => navigate('/search?bot=1')}
              className="relative flex w-full items-center gap-3 rounded-full border-2 border-brand-200 bg-[var(--color-surface-raised)] px-5 py-3.5 text-left shadow-[var(--shadow-float)] transition hover:border-brand-400"
            >
              <Sparkles size={18} className="shrink-0 animate-pulse text-brand-500" />
              <span className="flex-1 truncate text-body text-[var(--color-content-subtle)]">
                Research your next car with AI&hellip;
              </span>
              <Badge tone="brand" className="hidden shrink-0 sm:inline-flex">
                Ask AI
              </Badge>
            </button>
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
            subtitle="Zero-emission rides, ready to book"
            listings={electricCars}
            isLoading={electricLoading}
          />
          {cityA && (
            <ListingRail
              title={`Popular in ${cityA}`}
              subtitle="Top-rated cars near you"
              listings={cityACars}
              isLoading={cityALoading}
            />
          )}
          {cityB && (
            <ListingRail
              title={`Popular in ${cityB}`}
              subtitle="Top-rated cars near you"
              listings={cityBCars}
              isLoading={cityBLoading}
            />
          )}
        </div>

        {/* Featured slideshow — a rotating BaT-style hero (auto every 3s) ─── */}
        {(featured?.length ?? 0) > 0 && (
          <div className="mt-2">
            <h2 className="mb-3 text-h3">Featured this week</h2>
            <FeaturedSlideshow listings={featured ?? []} />
          </div>
        )}

        {/* Full results grid — the categories rail + electric/top-ranked
            chips filter this. */}
        <section className="mt-8 min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h3">{topRanked ? 'Top ranked cars' : 'Recommended for you'}</h2>
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
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
              <PageBar
                page={page}
                pageCount={pageCount}
                total={total}
                pageSize={PAGE_SIZE}
                onChange={(p) => {
                  setPage(p);
                  scrollToResults();
                }}
              />
            </>
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
      {isLoading ? (
        <div
          className="-mx-4 mt-3 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-busy="true"
          aria-label="Loading cars"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="w-[68%] shrink-0 sm:w-60">
              <ListingCardSkeleton />
            </div>
          ))}
        </div>
      ) : (
        <div className="-mx-4 mt-3 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(listings ?? []).slice(0, 12).map((listing) => (
            <div key={listing.id} className="w-[68%] shrink-0 sm:w-60">
              <ListingCard listing={listing} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Page controls for the recommended grid: Prev / numbered pages / Next, plus a
 * "Showing X–Y of N cars" summary. Shows a windowed range of page numbers so it
 * stays compact even with many pages.
 */
function PageBar({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const start = Math.max(0, Math.min(page - 2, pageCount - 5));
  const end = Math.min(pageCount, start + 5);
  const nums = Array.from({ length: end - start }, (_, i) => start + i);
  const btn =
    'flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-control)] border px-3 text-body-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const idle =
    'border-[var(--color-line-strong)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]';
  // Current page inverts, same "fill and weight, not hue" language as a
  // selected Chip — a page number is a toggle, not the screen's one action.
  const active = 'border-[var(--color-surface-inverse)] bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]';

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <p className="tabular text-body-sm text-[var(--color-content-muted)]">
        Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total} cars
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          className={cn(btn, idle)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        {start > 0 && <span className="px-1 text-[var(--color-content-subtle)]">…</span>}
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cn(btn, 'tabular', n === page ? active : idle)}
          >
            {n + 1}
          </button>
        ))}
        {end < pageCount && <span className="px-1 text-[var(--color-content-subtle)]">…</span>}
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount - 1}
          className={cn(btn, idle)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
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

        {/* Thumbnails — the other featured cars (desktop only) */}
        <div className="hidden grid-cols-2 grid-rows-2 gap-1 md:grid">
          {others.map((o) => {
            const idx = items.indexOf(o);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setI(idx)}
                className="group relative overflow-hidden"
                aria-label={`Show ${o.title}`}
              >
                <Img
                  src={o.photos[0]}
                  alt={o.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
