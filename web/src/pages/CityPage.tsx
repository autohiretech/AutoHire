import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CarFront, MapPin } from 'lucide-react';
import { client } from '@/lib/client';
import { CarAvailabilityCard } from '@/components/CarAvailabilityCard';
import { Card, CardBody, Spinner } from '@/components/ui';

/**
 * All cars in one city, each showing its live availability. Reached from the
 * Cities tab on the home page. Filtered by city name only (city names are unique
 * across markets) so a shared link works whatever market the viewer is in.
 */
export function CityPage() {
  const { city = '' } = useParams();
  const cityName = decodeURIComponent(city);

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['cityListings', cityName],
    queryFn: () => client.listListings({ city: cityName }),
  });

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft size={16} /> Back to browse
      </Link>

      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <MapPin size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Cars in {cityName}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {isLoading
              ? 'Loading…'
              : `${listings.length} ${listings.length === 1 ? 'car' : 'cars'} · availability shown live`}
          </p>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={26} />
          </div>
        ) : listings.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-ink-500">
              <CarFront size={28} className="text-ink-300" />
              <p className="text-sm">No cars listed in {cityName} yet.</p>
              <Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
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
