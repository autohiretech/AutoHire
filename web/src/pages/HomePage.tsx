import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CarFront, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { CarCategory, OwnerType, Transmission } from '@autohire/shared';
import { mockClient, type ListingFilters } from '@/mocks/client';
import { Button, Card, CardBody, Input, Label, Select, Spinner } from '@/components/ui';
import { ListingCard } from '@/components/ListingCard';

const CITIES = ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'];

const CATEGORIES: { value: CarCategory; label: string }[] = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: '4x4', label: '4x4' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'minibus', label: 'Minibus' },
  { value: 'luxury', label: 'Luxury' },
];

const PRICE_OPTIONS = [30000, 50000, 80000, 120000];
const SEAT_OPTIONS = [2, 4, 5, 7];

/**
 * A1 — Search & browse. The search bar and filter panel drive a `ListingFilters`
 * object that's part of the TanStack Query key, so results refetch through
 * `mockClient.listListings` whenever a filter changes. Handles loading + empty
 * states.
 */
export function HomePage() {
  const [filters, setFilters] = useState<ListingFilters>({});
  const [queryInput, setQueryInput] = useState('');

  const { data: listings, isLoading } = useQuery({
    queryKey: ['listings', filters],
    queryFn: () => mockClient.listListings(filters),
  });

  function setFilter<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setFilter('query', queryInput.trim() || undefined);
  }

  function clearFilters() {
    setFilters({});
    setQueryInput('');
  }

  const activeCount = Object.keys(filters).length;

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-600 to-brand-700 text-white">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h1 className="max-w-2xl text-3xl font-bold sm:text-4xl">
            Rent a car from people and agencies across Rwanda
          </h1>
          <p className="mt-3 max-w-xl text-brand-50">
            Self-drive cars in Kigali and beyond — booked, paid, and protected on one platform.
          </p>

          <Card className="mt-6 max-w-2xl">
            <CardBody>
              <form onSubmit={onSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Select
                    value={filters.city ?? ''}
                    onChange={(e) => setFilter('city', e.target.value || undefined)}
                    aria-label="City"
                  >
                    <option value="">Anywhere in Rwanda</option>
                    {CITIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1">
                  <Input
                    placeholder="Make, model, or keyword"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    aria-label="Search cars"
                  />
                </div>
                <Button type="submit" size="lg" className="sm:w-auto">
                  <Search size={18} /> Search
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Browse */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        {/* Filter panel */}
        <Card className="mb-6">
          <CardBody>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-700">
              <SlidersHorizontal size={16} className="text-brand-600" />
              Filters
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="ml-auto text-xs font-medium text-brand-600 hover:underline"
                >
                  Clear all ({activeCount})
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <Label htmlFor="f-category">Category</Label>
                <Select
                  id="f-category"
                  value={filters.category ?? ''}
                  onChange={(e) =>
                    setFilter('category', (e.target.value || undefined) as CarCategory | undefined)
                  }
                >
                  <option value="">Any</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
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

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink-900">
            {isLoading
              ? 'Finding cars…'
              : `${listings?.length ?? 0} car${listings?.length === 1 ? '' : 's'} available`}
          </h2>
          <span className="flex items-center gap-1 text-sm text-ink-500">
            <ShieldCheck size={16} className="text-brand-600" /> Verified hosts
          </span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : listings && listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
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
      </section>
    </div>
  );
}
