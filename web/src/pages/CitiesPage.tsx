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
    <div className="bg-[var(--color-surface)]">
      <div className="mx-auto max-w-[1500px] px-4 pt-8">
        <BrowseTabs />
      </div>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
            <MapPin size={22} />
          </span>
          <div>
            <h1 className="text-h2">Browse by city</h1>
            <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
              {cities.length} {cities.length === 1 ? 'city' : 'cities'} in {country.name}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {cities.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-[var(--color-content-muted)]">
                <MapPin size={28} className="text-[var(--color-content-subtle)]" />
                <p className="text-body-sm">No cities listed in {country.name} yet.</p>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {cities.map((c) => (
                <Link key={c} to={`/cities/${encodeURIComponent(c)}`}>
                  <Card
                    interactive
                    className="flex flex-col items-center gap-2 p-6 text-center text-[var(--color-content-muted)]"
                  >
                    <MapPin size={22} className="text-[var(--color-content-subtle)]" />
                    <span className="text-body-sm font-semibold text-[var(--color-content)]">{c}</span>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
