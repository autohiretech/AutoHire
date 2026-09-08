import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CarFront, MapPin } from 'lucide-react';
import { client } from '@/lib/client';
import { useBackToBrowse } from '@/lib/useBackToBrowse';
import { CarAvailabilityCard } from '@/components/CarAvailabilityCard';
import { Card, CardBody, Skeleton } from '@/components/ui';

/**
 * All cars in one city, each showing its live availability. Reached from the
 * Cities tab on the home page. Filtered by city name only (city names are unique
 * across markets) so a shared link works whatever market the viewer is in.
 */
export function CityPage() {
  const { city = '' } = useParams();
  const backToBrowse = useBackToBrowse();
  const cityName = decodeURIComponent(city);

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['cityListings', cityName],
    queryFn: () => client.listListings({ city: cityName }),
  });

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <button
        type="button"
        onClick={backToBrowse}
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        <ArrowLeft size={16} /> Back to browse
      </button>

      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
          <MapPin size={22} />
        </span>
        <div>
          <h1 className="text-h2">Cars in {cityName}</h1>
          <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
            {isLoading
              ? 'Loading…'
              : `${listings.length} ${listings.length === 1 ? 'car' : 'cars'} · availability shown live`}
          </p>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div
            className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
            aria-busy="true"
            aria-label="Loading cars"
          >
            {Array.from({ length: 8 }, (_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="h-32 w-full rounded-none" />
                <CardBody className="p-3">
                  <Skeleton className="h-3.5" style={{ width: '75%' }} />
                  <Skeleton className="mt-1.5 h-3" style={{ width: '50%' }} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Skeleton className="h-3.5" style={{ width: '35%' }} />
                    <Skeleton className="h-3.5" style={{ width: '20%' }} />
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-[var(--color-content-muted)]">
              <CarFront size={28} className="text-[var(--color-content-subtle)]" />
              <p className="text-body-sm">No cars listed in {cityName} yet.</p>
              <Link
                to="/cities"
                className="text-body-sm font-semibold text-[var(--color-accent-on)] hover:underline"
              >
                Browse other cities
              </Link>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {listings.map((l) => (
              <CarAvailabilityCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
