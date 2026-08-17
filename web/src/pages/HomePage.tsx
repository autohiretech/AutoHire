import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CarFront,
  ChevronDown,
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
import { CAR_CATEGORIES, CATEGORY_GROUPS } from '@/lib/categories';
import { Spinner } from '@/components/ui';
import { ListingCard } from '@/components/ListingCard';
import { CategoryRail } from '@/components/marketplace/CategoryRail';
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
 * A1 — Home dashboard, laid out like a B2B marketplace console (Alibaba-style):
 * a centred tab bar + AI Mode toggle, a big fused search box, a "welcome" quick-
 * links strip, then a console grid (category sidebar · showcase cards · discover
 * banner) and a recommended results grid. Everything is wired to real AutoHire
 * features — search, AI search, categories, listings, hosts — and keeps the
 * green brand palette. A floating rail links to Messages / Trips / Notifications.
 */
export function HomePage() {
  // Restore where the user was browsing (read once on mount).
  const [savedBrowse] = useState(loadBrowse);
  const [filters, setFilters] = useState<ListingFilters>(savedBrowse.filters ?? {});
  const [topRanked, setTopRanked] = useState(savedBrowse.topRanked ?? false);
  const [page, setPage] = useState(savedBrowse.page ?? 0);
  // Category groups are an accordion so the sidebar stays compact — vehicles open
  // by default; the machinery groups collapse into a header + count.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Vehicles: true });
  const resultsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { mode } = useAppMode();
  const { country } = useCountry();

  // Every pull is scoped to the selected market — switching country in the
  // header refilters the catalogue (and reprices via the display currency).
  const scoped = { ...filters, country: country.code };

  // Stable, market-scoped pull that feeds the showcase cards + host discovery.
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

  return (
    <div className="bg-gradient-to-b from-brand-50 to-white">
      {/* ── Section nav + AI search bar ─────────────────────────────────── */}
      <div className="mx-auto max-w-[1500px] px-4 pt-8">
        <BrowseTabs />

        {/* Styled to read as a research/ask bar, not a CTA button — car
            shopping is a research task, not a booking, and a solid filled
            pill invited "click to book" rather than "ask me something".
            Still no typing here: it's one click target, and the assistant
            asks whatever it needs once the panel is open. A soft pulsing
            glow behind the (now white, input-shaped) bar keeps it reading
            as the "alive", AI-driven entry point rather than a plain field. */}
        <div className="relative mx-auto mt-5 w-full max-w-3xl">
          <div
            aria-hidden
            className="animate-ai-glow absolute -inset-1.5 rounded-full bg-gradient-to-r from-brand-400 via-emerald-400 to-brand-500 opacity-40 blur-lg"
          />
          <button
            type="button"
            onClick={() => navigate('/search?bot=1')}
            className="relative flex w-full items-center gap-3 rounded-full border-2 border-brand-200 bg-white px-5 py-3.5 text-left shadow-sm transition hover:border-brand-400 hover:shadow-md"
          >
            <Sparkles size={18} className="shrink-0 animate-pulse text-brand-500" />
            <span className="flex-1 truncate text-base text-ink-400">
              Research your next car with AI&hellip;
            </span>
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 sm:flex">
              Ask AI
            </span>
          </button>
        </div>
      </div>

      {/* ── Welcome strip ─────────────────────────────────────────────────── */}
      <div className="mx-auto mt-8 max-w-[1500px] px-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-y border-ink-100 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold text-ink-900">Welcome to AutoHire</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
              <Leaf size={13} /> 90% electric, hybrid &amp; ecological
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-ink-700">
            {mode === 'host' ? (
              <Link to="/cars/new" className="flex items-center gap-1.5 hover:text-brand-600">
                <PlusCircle size={16} className="text-brand-600" /> List your car
              </Link>
            ) : (
              <Link to="/account" className="flex items-center gap-1.5 hover:text-brand-600">
                <PlusCircle size={16} className="text-brand-600" /> Become a host
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Featured slideshow — a rotating BaT-style hero (auto every 3s) ─── */}
      {(featured?.length ?? 0) > 0 && (
        <div className="mx-auto mt-5 max-w-[1500px] px-4">
          <FeaturedSlideshow listings={featured ?? []} />
        </div>
      )}

      {/* ── Categories rail + car results ─────────────────────────────────── */}
      <div ref={resultsRef} className="mx-auto mt-5 max-w-[1500px] scroll-mt-4 px-4 pb-10">
        {/* Mobile: a horizontal category rail. The vertical accordion sidebar is
            a desktop pattern — on a phone it buried the results, so below lg we
            swap in the scrollable rail instead. */}
        <div className="mb-4 lg:hidden">
          <CategoryRail
            value={filters.category}
            onSelect={(cat) => {
              setFilter('category', cat);
              scrollToResults();
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr] lg:items-start">
          {/* Category sidebar (desktop only). Sticks below the header once the
              slideshow scrolls past, so it stays put while the car grid scrolls. */}
          <aside className="hidden rounded-2xl border border-ink-100 bg-white p-2 shadow-card lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <p className="px-3 py-2 text-sm font-semibold text-ink-900">Categories for you</p>
            <button
              type="button"
              onClick={() => {
                setFilter('category', undefined);
                scrollToResults();
              }}
              className={cn(
                'mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                !filters.category
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink-700 hover:bg-ink-50',
              )}
            >
              <LayoutGrid size={17} className={!filters.category ? 'text-brand-600' : 'text-ink-400'} />
              All categories
            </button>
            {CATEGORY_GROUPS.map((group) => {
              const items = CAR_CATEGORIES.filter((c) => c.group === group);
              // Open if the user toggled it open, or the active category lives here.
              const open =
                (openGroups[group] ?? false) || items.some((i) => i.value === filters.category);
              return (
                <div key={group} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((p) => ({ ...p, [group]: !open }))}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400 transition-colors hover:bg-ink-50"
                    aria-expanded={open}
                  >
                    <span>
                      {group} <span className="text-ink-300">· {items.length}</span>
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn('text-ink-400 transition-transform', open && 'rotate-180')}
                    />
                  </button>
                  {open && (
                    <ul>
                      {items.map(({ value, label, icon: Icon }) => {
                        const active = filters.category === value;
                        return (
                          <li key={value}>
                            <button
                              type="button"
                              onClick={() => {
                                setFilter('category', active ? undefined : value);
                                scrollToResults();
                              }}
                              className={cn(
                                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                                active
                                  ? 'bg-brand-50 font-medium text-brand-700'
                                  : 'text-ink-700 hover:bg-ink-50',
                              )}
                            >
                              <span className="flex items-center gap-2.5">
                                <Icon size={17} className={active ? 'text-brand-600' : 'text-ink-400'} />
                                {label}
                              </span>
                              <ChevronRight size={15} className="text-ink-300" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </aside>

          {/* Car results — the categories rail filters these. */}
          <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink-900">
            {topRanked ? 'Top ranked cars' : 'Recommended for you'}
          </h2>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-xs text-ink-400 sm:flex">
              <ShieldCheck size={14} className="text-ink-400" /> All hosts verified
            </span>
            <button
              type="button"
              onClick={() => setFilter('fuel', filters.fuel === 'electric' ? undefined : 'electric')}
              aria-pressed={filters.fuel === 'electric'}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                filters.fuel === 'electric'
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-ink-200 text-ink-600 hover:bg-ink-50',
              )}
            >
              <Zap size={15} /> Electric
            </button>
            <button
              type="button"
              onClick={() => setTopRanked((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                topRanked
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-ink-200 text-ink-600 hover:bg-ink-50',
              )}
            >
              <TrendingUp size={15} /> Top ranked
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={28} />
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
                  className="text-sm font-medium text-brand-600 hover:underline"
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
    </div>
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
    'flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <p className="text-sm text-ink-500">
        Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total} cars
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          className={cn(btn, 'border-ink-200 text-ink-600 hover:bg-ink-50')}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        {start > 0 && <span className="px-1 text-ink-400">…</span>}
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cn(
              btn,
              n === page
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 text-ink-700 hover:bg-ink-50',
            )}
          >
            {n + 1}
          </button>
        ))}
        {end < pageCount && <span className="px-1 text-ink-400">…</span>}
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount - 1}
          className={cn(btn, 'border-ink-200 text-ink-600 hover:bg-ink-50')}
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
      className="overflow-hidden rounded-2xl border border-ink-100 bg-ink-900 shadow-card"
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
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/45" />
          <span className="absolute left-4 top-4 rounded bg-ink-900/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
            Featured
          </span>
          <div className="absolute right-4 top-3 max-w-[56%] text-right text-white sm:max-w-[75%]">
            <p className="line-clamp-1 text-lg font-bold drop-shadow sm:text-xl">{car.title}</p>
            <p className="line-clamp-1 text-sm text-white/85 drop-shadow">{subtitle}</p>
          </div>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white">
            <span className="rounded-md bg-black/55 px-2.5 py-1 text-sm font-semibold backdrop-blur-sm">
              <Price amount={listingHeadlinePrice(car).amount} currency={car.priceCurrency} />
              <span className="font-normal text-white/70"> /{listingHeadlinePrice(car).unit}</span>
            </span>
            {car.ratingCount > 0 && (
              <span className="flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-sm backdrop-blur-sm">
                <Star size={13} className="fill-accent-400 text-accent-400" /> {car.ratingAvg.toFixed(1)}
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
                <span className="absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-left text-[11px] font-medium text-white">
                  {o.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Progress dots */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 bg-ink-900 py-2">
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink-100 bg-white py-16 text-center shadow-card">
      <CarFront size={30} className="text-ink-300" />
      <p className="font-medium text-ink-700">{label}</p>
      {action}
    </div>
  );
}
