import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bell,
  CarFront,
  ChevronRight,
  FileText,
  MapPin,
  MessageSquare,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import type { Host, Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatRwf } from '@/lib/format';
import { CAR_CATEGORIES } from '@/lib/categories';
import { Spinner, toast } from '@/components/ui';
import { ListingCard } from '@/components/ListingCard';

const CITIES = ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'];

type Tab = 'cars' | 'hosts' | 'cities';

/**
 * A1 — Home dashboard, laid out like a B2B marketplace console (Alibaba-style):
 * a centred tab bar + AI Mode toggle, a big fused search box, a "welcome" quick-
 * links strip, then a console grid (category sidebar · showcase cards · discover
 * banner) and a recommended results grid. Everything is wired to real AutoHire
 * features — search, AI search, categories, listings, hosts — and keeps the
 * green brand palette. A floating rail links to Messages / Trips / Notifications.
 */
export function HomePage() {
  const [filters, setFilters] = useState<ListingFilters>({});
  const [aiMode, setAiMode] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab>('cars');
  const [topRanked, setTopRanked] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Stable, unfiltered pull that feeds the showcase cards + host discovery.
  const { data: featured } = useQuery({
    queryKey: ['listings', 'featured'],
    queryFn: () => client.listListings({}),
  });
  // Filtered pull that drives the recommended grid (refetches per filter change).
  const { data: listings, isLoading } = useQuery({
    queryKey: ['listings', filters],
    queryFn: () => client.listListings(filters),
  });
  const { data: hosts } = useQuery({ queryKey: ['hosts'], queryFn: () => client.listHosts() });

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
      setFilter('query', q || undefined);
    }
    setTab('cars');
    scrollToResults();
  }

  function scrollToResults() {
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const showcase = featured ?? [];
  const recent = showcase[0];
  const popular = showcase[1] ?? showcase[0];
  const topRated = [...showcase].sort((a, b) => b.ratingAvg - a.ratingAvg)[0];

  const results = topRanked
    ? [...(listings ?? [])].sort((a, b) => b.ratingAvg - a.ratingAvg)
    : listings ?? [];

  return (
    <div className="bg-gradient-to-b from-brand-50 to-white">
      {/* ── Tab bar + AI Mode ─────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 pt-8">
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
                setTab(t.key);
                scrollToResults();
              }}
              className={cn(
                'relative pb-1 transition-colors',
                tab === t.key ? 'text-brand-600' : 'text-ink-700 hover:text-ink-900',
              )}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute inset-x-0 -bottom-0.5 mx-auto h-0.5 w-6 rounded-full bg-brand-600" />
              )}
            </button>
          ))}
        </div>

        {/* ── Fused search box ────────────────────────────────────────────── */}
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
      </div>

      {/* ── Welcome strip ─────────────────────────────────────────────────── */}
      <div className="mx-auto mt-8 max-w-6xl px-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-y border-ink-100 py-4">
          <h2 className="text-lg font-bold text-ink-900">Welcome to AutoHire</h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-ink-700">
            <button
              type="button"
              onClick={() => {
                setAiMode(true);
                document.querySelector<HTMLInputElement>('input[aria-label="Describe the car you want"]')?.focus();
              }}
              className="flex items-center gap-1.5 hover:text-brand-600"
            >
              <FileText size={16} className="text-brand-600" /> Post a car request
            </button>
            <span className="hidden h-4 w-px bg-ink-200 sm:block" />
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
            <Link to="/cars/new" className="flex items-center gap-1.5 hover:text-brand-600">
              <PlusCircle size={16} className="text-brand-600" /> List your car
            </Link>
          </div>
        </div>
      </div>

      {/* ── Console grid: categories · showcase · discover ────────────────── */}
      <div className="mx-auto mt-5 max-w-6xl px-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          {/* Category sidebar */}
          <aside className="rounded-2xl border border-ink-100 bg-white p-2 shadow-sm">
            <p className="px-3 py-2 text-sm font-semibold text-ink-900">Categories for you</p>
            <ul className="max-h-80 overflow-y-auto">
              {CAR_CATEGORIES.map(({ value, label, icon: Icon }) => {
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
                        'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors',
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
          </aside>

          {/* Showcase cards + discover banner */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {recent && <ShowcaseCard eyebrow="Recently added" listing={recent} />}
            {popular && <ShowcaseCard eyebrow="Popular near you" listing={popular} />}
            {topRated && <ShowcaseCard eyebrow="Top rated" listing={topRated} showRating />}
            <DiscoverHostsCard
              count={hosts?.length}
              onView={() => {
                setTab('hosts');
                scrollToResults();
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Recommended (tab-driven) ──────────────────────────────────────── */}
      <section ref={resultsRef} className="mx-auto max-w-6xl scroll-mt-4 px-4 py-8">
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
            {CITIES.map((c) => {
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {results.map((listing) => (
              <ListingCard key={listing.id} listing={listing} compact />
            ))}
          </div>
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

      <FloatingRail />
    </div>
  );
}

/** A small "frequently searched"-style card that highlights one real listing. */
function ShowcaseCard({
  eyebrow,
  listing,
  showRating = false,
}: {
  eyebrow: string;
  listing: Listing;
  showRating?: boolean;
}) {
  return (
    <Link
      to={`/cars/${listing.id}`}
      className="group flex flex-col rounded-2xl border border-ink-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <p className="text-sm font-semibold text-ink-900">{eyebrow}</p>
      <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">{listing.title}</p>
      <div className="mt-3 flex flex-1 items-center justify-center">
        <img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-28 w-full rounded-lg object-cover"
        />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-brand-700">
          {formatRwf(listing.pricePerDayRwf)}
          <span className="font-normal text-ink-400"> /day</span>
        </span>
        {showRating && (
          <span className="flex items-center gap-1 text-xs font-medium text-ink-600">
            <Star size={13} className="fill-accent-400 text-accent-400" /> {listing.ratingAvg.toFixed(1)}
          </span>
        )}
      </div>
    </Link>
  );
}

/** The green "Discover new hosts" promo (mirrors Alibaba's manufacturers card). */
function DiscoverHostsCard({ count, onView }: { count?: number; onView: () => void }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-brand-100 to-brand-50 p-5">
      <div>
        <h3 className="text-lg font-bold text-brand-800">Discover verified hosts</h3>
        <p className="mt-1 text-sm text-brand-700/80">
          {count ? `${count} host${count === 1 ? '' : 's'} ready to rent` : 'Individuals & agencies you can trust'}
        </p>
      </div>
      <button
        type="button"
        onClick={onView}
        className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        View more <ChevronRight size={15} />
      </button>
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

/** Fixed vertical rail of shortcuts, echoing Alibaba's right-edge tools. */
function FloatingRail() {
  const items = [
    { to: '/messages', label: 'Messages', icon: MessageSquare },
    { to: '/trips', label: 'Trips', icon: CarFront },
    { to: '/notifications', label: 'Alerts', icon: Bell },
    { to: '/cars/new', label: 'List car', icon: PlusCircle },
  ];
  return (
    <div className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1 rounded-2xl border border-ink-100 bg-white/95 p-1.5 shadow-lg backdrop-blur lg:flex">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          <Icon size={20} />
          {label}
        </Link>
      ))}
    </div>
  );
}
