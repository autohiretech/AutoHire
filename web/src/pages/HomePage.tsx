import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CarFront, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { OwnerType, Transmission } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { Button, Card, CardBody, Label, Select, Spinner, toast } from '@/components/ui';
import { ListingCard } from '@/components/ListingCard';
import { MegaSearch } from '@/components/marketplace/MegaSearch';
import { CategoryRail } from '@/components/marketplace/CategoryRail';
import { PromoBanner } from '@/components/marketplace/PromoBanner';

const CITIES = ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'];

const PRICE_OPTIONS = [30000, 50000, 80000, 120000];
const SEAT_OPTIONS = [2, 4, 5, 7];

/**
 * A1 — Search & browse, styled as a marketplace (Alibaba/Amazon-like): a hero
 * mega-search, a category tile rail, a promo banner, then a dense results grid.
 * The search bar, category rail and filter panel all drive a `ListingFilters`
 * object that's part of the TanStack Query key, so results refetch through
 * `client.listListings` whenever a filter changes.
 */
export function HomePage() {
  const [filters, setFilters] = useState<ListingFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const { data: listings, isLoading } = useQuery({
    queryKey: ['listings', filters],
    queryFn: () => client.listListings(filters),
  });

  function setFilter<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function clearFilters() {
    setFilters({});
  }

  // AI Mode: turn a natural-language query into filters via the ai-search Edge
  // Function, then let the normal listings query run against them.
  async function runAiSearch(query: string) {
    if (!query) return;
    setAiBusy(true);
    try {
      const aiFilters = await client.aiSearch(query);
      setFilters(Object.keys(aiFilters).length ? aiFilters : { query });
    } catch (err) {
      // Fall back to a plain keyword search so the box still does something.
      setFilters({ query });
      toast.error(err instanceof Error ? err.message : 'AI search is unavailable — showing keyword results.');
    } finally {
      setAiBusy(false);
    }
  }

  const activeCount = Object.keys(filters).length;

  return (
    <div>
      {/* Hero + mega-search */}
      <section className="bg-gradient-to-b from-brand-600 to-brand-700 text-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h1 className="max-w-2xl text-3xl font-bold sm:text-4xl">
            Rent a car from people and agencies, anywhere
          </h1>
          <p className="mt-3 max-w-xl text-brand-50">
            Self-drive cars — booked, paid, and protected on one platform.
          </p>

          <div className="mt-6 max-w-3xl">
            <MegaSearch
              category={filters.category}
              onCategoryChange={(c) => setFilter('category', c)}
              query={filters.query ?? ''}
              onSearch={(q) => setFilter('query', q || undefined)}
              onAiSearch={runAiSearch}
              aiBusy={aiBusy}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {/* Category rail */}
        <CategoryRail value={filters.category} onSelect={(c) => setFilter('category', c)} />

        {/* Promo banner */}
        <PromoBanner />

        {/* Results */}
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-ink-900">
              {isLoading
                ? 'Finding cars…'
                : `${listings?.length ?? 0} car${listings?.length === 1 ? '' : 's'} available`}
            </h2>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1 text-sm text-ink-500 sm:flex">
                <ShieldCheck size={16} className="text-brand-600" /> Verified hosts
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                <SlidersHorizontal size={16} />
                Filters{activeCount > 0 ? ` (${activeCount})` : ''}
              </Button>
            </div>
          </div>

          {/* Collapsible filter panel */}
          {showFilters && (
            <Card className="mb-6">
              <CardBody>
                <div className="mb-3 flex items-center justify-between text-sm font-medium text-ink-700">
                  <span>Refine your search</span>
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      Clear all ({activeCount})
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <div>
                    <Label htmlFor="f-city">City</Label>
                    <Select
                      id="f-city"
                      value={filters.city ?? ''}
                      onChange={(e) => setFilter('city', e.target.value || undefined)}
                    >
                      <option value="">All cities</option>
                      {CITIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="f-owner">Host type</Label>
                    <Select
                      id="f-owner"
                      value={filters.ownerType ?? ''}
                      onChange={(e) =>
                        setFilter('ownerType', (e.target.value || undefined) as OwnerType | undefined)
                      }
                    >
                      <option value="">Any</option>
                      <option value="individual">Individual</option>
                      <option value="business">Business</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="f-transmission">Transmission</Label>
                    <Select
                      id="f-transmission"
                      value={filters.transmission ?? ''}
                      onChange={(e) =>
                        setFilter(
                          'transmission',
                          (e.target.value || undefined) as Transmission | undefined,
                        )
                      }
                    >
                      <option value="">Any</option>
                      <option value="automatic">Automatic</option>
                      <option value="manual">Manual</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="f-seats">Seats</Label>
                    <Select
                      id="f-seats"
                      value={filters.minSeats ?? ''}
                      onChange={(e) =>
                        setFilter('minSeats', e.target.value ? Number(e.target.value) : undefined)
                      }
                    >
                      <option value="">Any</option>
                      {SEAT_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}+ seats
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="f-price">Max price / day</Label>
                    <Select
                      id="f-price"
                      value={filters.maxPriceRwf ?? ''}
                      onChange={(e) =>
                        setFilter('maxPriceRwf', e.target.value ? Number(e.target.value) : undefined)
                      }
                    >
                      <option value="">Any</option>
                      {PRICE_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          Up to RWF {p.toLocaleString('en-RW')}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size={28} />
            </div>
          ) : listings && listings.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} compact />
              ))}
            </div>
          ) : (
            <Card>
              <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
                <CarFront size={32} className="text-ink-300" />
                <div>
                  <p className="font-medium text-ink-900">No cars match your filters</p>
                  <p className="mt-1 text-sm text-ink-500">
                    Try widening your search or clearing some filters.
                  </p>
                </div>
                {activeCount > 0 && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
