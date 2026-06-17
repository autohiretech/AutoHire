import { useQuery } from '@tanstack/react-query';
import { Building2, Search, ShieldCheck, User } from 'lucide-react';
import { mockClient } from '@/mocks/client';
import { formatRwf } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Rating,
  Spinner,
} from '@/components/ui';

/**
 * A0 landing page. Doubles as a smoke test for the design system + mock data
 * layer: it renders listings fetched through the mock client (with latency),
 * so loading/loaded states are exercised. A1 will replace this with real
 * search & browse screens.
 */
export function HomePage() {
  const { data: listings, isLoading } = useQuery({
    queryKey: ['listings'],
    queryFn: () => mockClient.listListings(),
  });

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
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Input placeholder="Where? e.g. Kigali" defaultValue="Kigali" />
              </div>
              <div className="flex-1">
                <Input type="date" defaultValue="2026-06-20" />
              </div>
              <Button size="lg" className="sm:w-auto">
                <Search size={18} /> Search
              </Button>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Listings */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink-900">Cars available now</h2>
          <span className="flex items-center gap-1 text-sm text-ink-500">
            <ShieldCheck size={16} className="text-brand-600" /> Verified hosts
          </span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {listings?.map((listing) => (
              <Card key={listing.id} className="overflow-hidden">
                <img
                  src={listing.photos[0]}
                  alt={listing.title}
                  className="h-44 w-full object-cover"
                />
                <CardBody>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Badge tone={listing.ownerType === 'business' ? 'accent' : 'brand'}>
                      {listing.ownerType === 'business' ? (
                        <>
                          <Building2 size={12} /> Business host
                        </>
                      ) : (
                        <>
                          <User size={12} /> Individual host
                        </>
                      )}
                    </Badge>
                    <Rating value={listing.ratingAvg} count={listing.ratingCount} />
                  </div>
                  <h3 className="line-clamp-1 font-semibold text-ink-900">{listing.title}</h3>
                  <p className="text-sm text-ink-500">{listing.location}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-semibold text-ink-900">
                      {formatRwf(listing.pricePerDayRwf)}
                      <span className="font-normal text-ink-500"> / day</span>
                    </span>
                    <Badge tone={listing.bookingMode === 'instant' ? 'success' : 'neutral'}>
                      {listing.bookingMode === 'instant' ? 'Instant book' : 'Request to book'}
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
