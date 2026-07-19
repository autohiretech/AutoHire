import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CarFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Leaf,
  MapPin,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { Host, Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES, CATEGORY_GROUPS } from '@/lib/categories';
import { Spinner, toast } from '@/components/ui';
import { ListingCard } from '@/components/ListingCard';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { AiMode } from '@/components/marketplace/AiMode';
import { useAppMode } from '@/lib/appMode';
import { useCountry } from '@/lib/country';
import { citiesFor } from '@/lib/cities';

const PAGE_SIZE = 24;

/**
 * Listing grid: 2 / 3 / 4 fixed columns. A short final row leaves empty cells rather
 * than stretching its cards — under flex `grow` a row of one card blew up to full
 * width and no longer matched the cards above it.
 */
const CARD_GRID = 'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4';

type Tab = 'cars' | 'hosts' | 'cities';

/**
 * The browse state we remember (per tab session) so clicking into a car and
 * coming back lands on the same page/filters instead of resetting to page 1.
 * Pairs with <ScrollMemory> which restores the scroll offset.
 */
const BROWSE_KEY = 'autohire.home-browse';
type BrowseState = { filters: ListingFilters; tab: Tab; topRanked: boolean; page: number };
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
  // AI Mode lives in the URL (?view=ai) so navigating "home" (the logo → "/")
  // clears it and returns to the dashboard, instead of getting stuck because
  // the route didn't change.
  const [searchParams, setSearchParams] = useSearchParams();
  const aiMode = searchParams.get('view') === 'ai';
  const setAiMode = (next: boolean | ((v: boolean) => boolean)) => {
    const on = typeof next === 'function' ? next(aiMode) : next;
    const params = new URLSearchParams(searchParams);
    if (on) params.set('view', 'ai');
    else params.delete('view');
    setSearchParams(params, { replace: true });
  };
  const [aiBusy, setAiBusy] = useState(false);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab>(savedBrowse.tab ?? 'cars');
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
    queryKey: ['listings-page', scoped, topRanked, page],
    queryFn: () =>
      client.listListingsPage(scoped, page, PAGE_SIZE, topRanked ? 'rating' : undefined),
    placeholderData: keepPreviousData, // keep the old page visible while the next loads
  });
  const { data: hosts } = useQuery({ queryKey: ['hosts'], queryFn: () => client.listHosts() });

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
      sessionStorage.setItem(BROWSE_KEY, JSON.stringify({ filters, tab, topRanked, page }));
    } catch {
      /* storage full/disabled — non-critical */
    }
  }, [filters, tab, topRanked, page]);

  function setFilter<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function runSearch() {
    const q = text.trim();
    if (aiMode) {
      if (!q) return;
      setAiBusy(true);
      try {
        const aiFilters = await client.aiSearch(q);
        setFilters(Object.keys(aiFilters).length ? aiFilters : { query: q });
      } catch (err) {
        setFilters({ query: q });
        toast.error(
          err instanceof Error ? err.message : 'AI search is unavailable — showing keyword results.',
        );
      } finally {
        setAiBusy(false);
      }
    } else {
      // A plain search opens the dedicated results page (Alibaba "Products"
      // style) rather than filtering inline on the dashboard.
      if (!q) return;
      navigate(`/search?q=${encodeURIComponent(q)}`);
      return;
    }
    setTab('cars');
    scrollToResults();
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
      {/* ── Tab bar + AI Mode ─────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1500px] px-4 pt-8">
        <div className="flex items-center justify-center gap-5 text-lg font-semibold sm:gap-7">
          <button
            type="button"
            onClick={() => setAiMode((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 transition-colors',
              aiMode ? 'text-accent-600' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            AI Mode <Sparkles size={16} className={aiMode ? 'text-accent-500' : 'text-accent-400'} />
          </button>
          <span className="h-5 w-px bg-ink-200" />
          {(
            [
              { key: 'cars', label: 'Cars' },
              { key: 'hosts', label: 'Hosts' },
              { key: 'cities', label: 'Cities' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setAiMode(false);
                setTab(t.key);
                scrollToResults();
              }}
              className={cn(
                'relative pb-1 transition-colors',
                tab === t.key && !aiMode ? 'text-brand-600' : 'text-ink-700 hover:text-ink-900',
              )}
            >
              {t.label}
              {tab === t.key && !aiMode && (
                <span className="absolute inset-x-0 -bottom-0.5 mx-auto h-0.5 w-6 rounded-full bg-brand-600" />
              )}
            </button>
          ))}
        </div>

        {/* ── Fused search box (standard mode only) ────────────────────────── */}
        {!aiMode && (
        <div className="mx-auto mt-5 max-w-3xl">
          <div
            className={cn(
              'rounded-2xl p-[3px] shadow-lg transition-colors',
              aiMode
                ? 'bg-gradient-to-r from-accent-400 to-accent-600'
                : 'bg-gradient-to-r from-brand-400 via-brand-500 to-accent-500',
            )}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
              className="rounded-[14px] bg-white px-5 pt-4 pb-3"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  aiMode
                    ? 'Describe the car you want — e.g. “cheap automatic SUV for 5 people”'
                    : 'Search self-drive cars by make, model, or city'
                }
                aria-label={aiMode ? 'Describe the car you want' : 'Search cars'}
                className="w-full text-base text-ink-900 outline-none placeholder:text-ink-400"
              />
              <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-3">
                <button
                  type="button"
                  onClick={() => setAiMode((v) => !v)}
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium transition-colors',
                    aiMode ? 'text-accent-600' : 'text-ink-500 hover:text-ink-800',
                  )}
                >
                  <Sparkles size={18} /> {aiMode ? 'AI Mode on' : 'Describe with AI'}
                </button>
                <button
                  type="submit"
                  disabled={aiBusy}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-6 py-2 font-medium text-white transition-colors disabled:opacity-70',
                    aiMode
                      ? 'bg-gradient-to-r from-accent-500 to-accent-600 hover:brightness-95'
                      : 'bg-gradient-to-r from-brand-500 to-brand-600 hover:brightness-95',
                  )}
                >
                  {aiMode ? <Sparkles size={18} /> : <Search size={18} />}
                  {aiBusy ? 'Thinking…' : 'Search'}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}
      </div>

      {aiMode && <AiMode />}

      {!aiMode && (
        <>
      {/* ── Welcome strip ─────────────────────────────────────────────────── */}
      <div className="mx-auto mt-8 max-w-[1500px] px-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-y border-ink-100 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold text-ink-900">Welcome to AutoHire</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
              <Leaf size={13} /> 85%+ electric fleet
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-ink-700">
            <button
              type="button"
              onClick={() => {
                setTopRanked(true);
                setTab('cars');
                scrollToResults();
              }}
              className="flex items-center gap-1.5 hover:text-brand-600"
            >
              <TrendingUp size={16} className="text-brand-600" /> Top ranked cars
            </button>
            <span className="hidden h-4 w-px bg-ink-200 sm:block" />
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr] lg:items-start">
          {/* Category sidebar */}
          <aside className="rounded-2xl border border-ink-100 bg-white p-2 shadow-sm">
            <p className="px-3 py-2 text-sm font-semibold text-ink-900">Categories for you</p>
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
                                setTab('cars');
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

          {/* Car results (tab-driven) — the categories rail filters these. */}
          <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink-900">
            {tab === 'hosts'
              ? 'Verified hosts'
              : tab === 'cities'
                ? 'Browse by city'
                : topRanked
                  ? 'Top ranked cars'
                  : 'Recommended for you'}
          </h2>
          {tab === 'cars' && (
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1 text-sm text-ink-500 sm:flex">
                <ShieldCheck size={16} className="text-brand-600" /> Verified hosts
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
          )}
        </div>

        {tab === 'cities' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {citiesFor(country.code).map((c) => {
              const active = filters.city === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setFilter('city', active ? undefined : c);
                    setTab('cars');
                    scrollToResults();
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-2xl border p-6 text-center transition-colors',
                    active
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
                  )}
                >
                  <MapPin size={22} className={active ? 'text-brand-600' : 'text-ink-400'} />
                  <span className="text-sm font-medium">{c}</span>
                </button>
              );
            })}
          </div>
        ) : tab === 'hosts' ? (
          hosts && hosts.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {hosts.map((h) => (
                <HostCard key={h.id} host={h} />
              ))}
            </div>
          ) : (
            <EmptyState label="No hosts to show yet." />
          )
        ) : isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : results.length > 0 ? (
          <>
            <div className={CARD_GRID}>
              {results.map((listing) => (
                <ListingCard key={listing.id} listing={listing} compact />
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
        </>
      )}
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
      className="overflow-hidden rounded-2xl border border-ink-100 bg-ink-900 shadow-sm"
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
          <div className="absolute right-4 top-3 max-w-[75%] text-right text-white">
            <p className="line-clamp-1 text-lg font-bold drop-shadow sm:text-xl">{car.title}</p>
            <p className="line-clamp-1 text-sm text-white/85 drop-shadow">{subtitle}</p>
          </div>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white">
            <span className="rounded-md bg-black/55 px-2.5 py-1 text-sm font-semibold backdrop-blur-sm">
              <Price amount={car.pricePerDayRwf} currency={car.priceCurrency} />
              <span className="font-normal text-white/70"> /day</span>
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

/** Compact host tile for the Hosts tab. */
function HostCard({ host }: { host: Host }) {
  const isBusiness = host.ownerType === 'business';
  const name = host.businessName || host.fullName;
  return (
    <div className="flex flex-col items-center rounded-2xl border border-ink-100 bg-white p-4 text-center shadow-sm">
      {host.avatarUrl ? (
        <img src={host.avatarUrl} alt={name} className="h-14 w-14 rounded-full object-cover" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-ink-900">{name}</p>
      <p className="text-xs capitalize text-ink-500">
        {isBusiness ? 'Business host' : 'Individual host'}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-600">
        <span className="flex items-center gap-1">
          <CarFront size={13} className="text-ink-400" /> {host.vehicleCount}
        </span>
        {host.verification === 'verified' && (
          <span className="flex items-center gap-1 text-brand-600">
            <ShieldCheck size={13} /> Verified
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink-100 bg-white py-16 text-center">
      <CarFront size={30} className="text-ink-300" />
      <p className="font-medium text-ink-700">{label}</p>
      {action}
    </div>
  );
}
