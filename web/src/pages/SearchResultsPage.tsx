import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ChevronRight,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  User,
} from 'lucide-react';
import type { Host, Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES } from '@/lib/categories';
import { buildSummary, interpretQuery } from '@/lib/demoAi';
import { useAuth } from '@/lib/auth';
import { ListingCard } from '@/components/ListingCard';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { Avatar, Spinner, toast } from '@/components/ui';
import { useCountry } from '@/lib/country';
import { citiesFor, countryOfCity } from '@/lib/cities';

/**
 * Listing grid: 2 / 3 / 4 fixed columns. A short final row leaves empty cells rather
 * than stretching its cards — under flex `grow` a row of one card blew up to full
 * width and no longer matched the cards above it.
 */
const CARD_GRID = 'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4';

/** "Select by" refinement chips → the ListingFilters patch each one applies. */
const SELECT_BY: { label: string; patch: ListingFilters }[] = [
  { label: 'Automatic', patch: { transmission: 'automatic' } },
  { label: 'Manual', patch: { transmission: 'manual' } },
  { label: 'Business host', patch: { ownerType: 'business' } },
  { label: 'Individual host', patch: { ownerType: 'individual' } },
  { label: '5+ seats', patch: { minSeats: 5 } },
  { label: '7+ seats', patch: { minSeats: 7 } },
  { label: 'Under RWF 50k', patch: { maxPriceRwf: 50000 } },
];

/**
 * Search results page (Alibaba "Products / Deep Search" style). A plain search
 * lands here (not the dashboard, and not the conversational AI Mode). The demo
 * AI ([interpretQuery]) reads the query into filters, we surface a "Deep search"
 * summary + a featured host block, then attribute/refinement chips over a
 * product grid. All results are real listings; only the interpretation is demo.
 */
export function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { country } = useCountry();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [extra, setExtra] = useState<ListingFilters>({});
  const [showMore, setShowMore] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  // Start (or reopen) a chat with a host about one of their cars, then jump into
  // the conversation. Guests are sent to sign in first, returning here after.
  async function startChat(listingId: string, hostId: string) {
    if (!user) {
      navigate('/login', { state: { from: `/search?q=${encodeURIComponent(q)}` } });
      return;
    }
    if (user.id === hostId) {
      navigate('/messages');
      return;
    }
    setChatBusy(true);
    try {
      const conv = await client.getOrCreateConversation(listingId, user.id, hostId);
      navigate(`/messages/${conv.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the chat. Please try again.');
    } finally {
      setChatBusy(false);
    }
  }

  // Chips are per-market, so drop them when the query or the market changes.
  useEffect(() => {
    setText(q);
    setExtra({});
  }, [q, country.code]);

  const aiFilters = useMemo(() => interpretQuery(q), [q]);
  const base = useMemo<ListingFilters>(
    () => (Object.keys(aiFilters).length ? aiFilters : q ? { query: q } : {}),
    [aiFilters, q],
  );
  // Results are scoped to the selected market. If the query itself names a city in a
  // different market ("SUVs in Dubai" while browsing Rwanda), follow the city instead
  // of returning an empty grid.
  const filters = useMemo<ListingFilters>(() => {
    const merged = { ...base, ...extra };
    return { ...merged, country: countryOfCity(merged.city) ?? country.code };
  }, [base, extra, country.code]);

  const { data: listings, isLoading } = useQuery({
    queryKey: ['search', filters],
    queryFn: () => client.listListings(filters),
  });
  const { data: hosts } = useQuery({ queryKey: ['hosts'], queryFn: () => client.listHosts() });

  const results = listings ?? [];
  const ranked = useMemo(() => [...results].sort((a, b) => b.ratingAvg - a.ratingAvg), [results]);
  const topMatch = ranked[0];

  // Featured host = the host of the top match, with all of their matching cars.
  const featuredHost = useMemo<Host | undefined>(
    () => hosts?.find((h) => h.id === topMatch?.hostId),
    [hosts, topMatch],
  );
  const featuredCars = useMemo(
    () => (topMatch ? ranked.filter((l) => l.hostId === topMatch.hostId) : []),
    [ranked, topMatch],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    setParams(t ? { q: t } : {});
  }

  function togglePatch(patch: ListingFilters) {
    const active = Object.entries(patch).every(([k, v]) => extra[k as keyof ListingFilters] === v);
    setExtra((prev) => {
      const next = { ...prev };
      if (active) for (const k of Object.keys(patch)) delete next[k as keyof ListingFilters];
      else Object.assign(next, patch);
      return next;
    });
  }

  const activeExtra = Object.keys(extra).length;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6">
      {/* Search bar */}
      <form onSubmit={onSubmit} className="flex items-stretch gap-2">
        <div className="flex flex-1 items-center overflow-hidden rounded-full border-2 border-brand-500 bg-white focus-within:border-brand-600">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search self-drive cars — describe what you need"
            aria-label="Search cars"
            className="min-w-0 flex-1 px-5 py-2.5 text-sm text-ink-900 outline-none placeholder:text-ink-400"
          />
          <button
            type="submit"
            className="m-1 flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2 text-sm font-medium text-white hover:brightness-95"
          >
            <Search size={16} /> Search
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate('/?view=ai')}
          className="hidden shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-accent-600 hover:text-accent-700 sm:flex"
        >
          <Sparkles size={16} /> Discover a new way to search with AI
        </button>
      </form>

      {/* Deep search heading + AI summary */}
      <div className="mt-6 flex items-center gap-2">
        <Sparkles size={18} className="text-accent-500" />
        <h1 className="text-lg font-bold text-ink-900">Deep search results</h1>
        <span className="text-sm text-ink-400">for “{q || 'all cars'}”</span>
      </div>
      {!isLoading && (
        <p className="mt-1.5 max-w-4xl text-sm text-ink-600">{buildSummary(q || 'cars', results)}</p>
      )}

      {/* Featured host / supplier block */}
      {featuredHost && featuredCars.length > 0 && (
        <FeaturedSupplier
          host={featuredHost}
          cars={featuredCars}
          onChat={() => startChat(featuredCars[0].id, featuredHost.id)}
          chatBusy={chatBusy}
        />
      )}

      {/* Attributes (categories) */}
      <ChipRow
        label="Categories:"
        right={
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
              showMore
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-ink-300 text-ink-700 hover:bg-ink-50',
            )}
          >
            <SlidersHorizontal size={14} /> More filters
          </button>
        }
      >
        {CAR_CATEGORIES.map(({ value, label }) => (
          <Chip
            key={value}
            active={extra.category === value}
            onClick={() => setExtra((p) => ({ ...p, category: p.category === value ? undefined : value }))}
          >
            {label}
          </Chip>
        ))}
      </ChipRow>

      {/* More filters — cities */}
      {showMore && (
        <ChipRow label="City:">
          {citiesFor(country.code).map((c) => (
            <Chip
              key={c}
              active={extra.city === c}
              onClick={() => setExtra((p) => ({ ...p, city: p.city === c ? undefined : c }))}
            >
              {c}
            </Chip>
          ))}
        </ChipRow>
      )}

      {/* Select by */}
      <ChipRow
        label="Select by:"
        right={
          activeExtra > 0 ? (
            <button
              type="button"
              onClick={() => setExtra({})}
              className="shrink-0 text-sm font-medium text-brand-600 hover:underline"
            >
              Clear all
            </button>
          ) : undefined
        }
      >
        {SELECT_BY.map(({ label, patch }) => (
          <Chip
            key={label}
            active={Object.entries(patch).every(([k, v]) => extra[k as keyof ListingFilters] === v)}
            onClick={() => togglePatch(patch)}
          >
            {label}
          </Chip>
        ))}
      </ChipRow>

      {/* Product grid */}
      <div className="mt-6">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : results.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-ink-500">
              {results.length} car{results.length === 1 ? '' : 's'} found
            </p>
            <div className={CARD_GRID}>
              {results.map((l) => (
                <ListingCard key={l.id} listing={l} compact />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink-100 bg-white py-16 text-center">
            <Search size={28} className="text-ink-300" />
            <p className="font-medium text-ink-700">No cars match “{q}”.</p>
            <p className="text-sm text-ink-500">Try a broader search or clear the refinements.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Featured host card with Chat/Contact + a row of the host's matching cars. */
function FeaturedSupplier({
  host,
  cars,
  onChat,
  chatBusy,
}: {
  host: Host;
  cars: Listing[];
  onChat: () => void;
  chatBusy: boolean;
}) {
  const isBusiness = host.ownerType === 'business';
  const name = host.businessName || host.fullName;
  const lead = cars[0];
  return (
    <div className="relative mt-4 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
      <span className="absolute bottom-2 right-3 text-[10px] font-medium text-ink-300">Featured</span>
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Hero image */}
        <Link to={`/cars/${lead.id}`} className="shrink-0 lg:w-64">
          <Img
            src={lead.photos[0]}
            alt={name}
            className="h-40 w-full rounded-xl object-cover lg:h-full"
          />
        </Link>

        <div className="min-w-0 flex-1">
          {/* Host header + actions */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={name} src={host.avatarUrl} size="md" />
              <div>
                <p className="font-semibold text-ink-900">{name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                  <span className="flex items-center gap-1 font-medium text-brand-600">
                    <ShieldCheck size={13} /> Verified
                  </span>
                  <span className="flex items-center gap-1">
                    {isBusiness ? <Building2 size={13} /> : <User size={13} />}
                    {isBusiness ? 'Business host' : 'Individual host'}
                  </span>
                  <span>{host.vehicleCount} cars</span>
                  <span>{lead.city}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onChat}
                disabled={chatBusy}
                className="rounded-full border border-brand-500 bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {chatBusy ? 'Starting…' : 'Chat now'}
              </button>
              <Link
                to={`/cars/${lead.id}`}
                className="rounded-full border border-ink-300 px-4 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                Contact host
              </Link>
            </div>
          </div>

          {/* Product row */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cars.slice(0, 6).map((c) => (
              <Link key={c.id} to={`/cars/${c.id}`} className="group block">
                <div className="overflow-hidden rounded-lg bg-ink-50">
                  <Img
                    src={c.photos[0]}
                    alt={c.title}
                    className="h-24 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-ink-600">{c.title}</p>
                <p className="text-sm font-semibold text-ink-900">
                  <Price amount={c.pricePerDayRwf} currency={c.priceCurrency} />
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A labelled, horizontally scrollable chip row with an optional right action. */
function ChipRow({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="shrink-0 text-sm font-medium text-ink-500">{label}</span>
      <div className="flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-center gap-2">
          {children}
          <ChevronRight size={16} className="shrink-0 text-ink-300" />
        </div>
      </div>
      {right}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700'
          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50',
      )}
    >
      {children}
    </button>
  );
}
