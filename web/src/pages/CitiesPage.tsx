import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useCountry } from '@/lib/country';
import { citiesFor } from '@/lib/cities';
import { Card, CardBody } from '@/components/ui';
import { BrowseTabs } from '@/components/marketplace/BrowseTabs';

/**
 * Every city with inventory in the selected market — its own page (was a tab
 * inline on the home dashboard). <BrowseTabs> stays pinned at the top so
 * switching to Cars or Hosts is one click, not a trip back to "/" first.
 * Each tile opens that city's live car list.
 */
export function CitiesPage() {
  const { country } = useCountry();
  const cities = citiesFor(country.code);

  return (
    <div className="bg-gradient-to-b from-brand-50 to-white">
      <div className="mx-auto max-w-[1500px] px-4 pt-8">
        <BrowseTabs />
      </div>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <MapPin size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Browse by city</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {cities.length} {cities.length === 1 ? 'city' : 'cities'} in {country.name}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {cities.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-ink-500">
                <MapPin size={28} className="text-ink-300" />
                <p className="text-sm">No cities listed in {country.name} yet.</p>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {cities.map((c) => (
                <Link
                  key={c}
                  to={`/cities/${encodeURIComponent(c)}`}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-ink-200 bg-white p-6 text-center text-ink-700 shadow-card transition-all duration-200 hover:-translate-y-1 hover:border-ink-300 hover:shadow-card-hover"
                >
                  <MapPin size={22} className="text-ink-400" />
                  <span className="text-sm font-medium">{c}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
