import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { client } from '@/lib/client';
import { HostCard } from '@/components/HostCard';
import { Spinner, Card, CardBody } from '@/components/ui';
import { BrowseTabs } from '@/components/marketplace/BrowseTabs';

/**
 * All verified hosts — its own page (was a tab inline on the home dashboard,
 * sharing the car-browse layout even though hosts have nothing to do with car
 * categories or pagination). <BrowseTabs> stays pinned at the top so switching
 * to Cars or Cities is one click, not a trip back to "/" first.
 */
export function HostsPage() {
  const [query, setQuery] = useState('');
  const { data: hosts, isLoading } = useQuery({ queryKey: ['hosts'], queryFn: () => client.listHosts() });

  const filtered = useMemo(() => {
    const list = hosts ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((h) => (h.businessName || h.fullName).toLowerCase().includes(q));
  }, [hosts, query]);

  return (
    <div className="bg-gradient-to-b from-brand-50 to-white">
      <div className="mx-auto max-w-[1500px] px-4 pt-8">
        <BrowseTabs />
      </div>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <Users size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">Verified hosts</h1>
              <p className="mt-0.5 text-sm text-ink-500">
                {isLoading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'host' : 'hosts'}`}
              </p>
            </div>
          </div>

          <div className="flex w-full items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 shadow-sm sm:w-72">
            <Search size={15} className="shrink-0 text-ink-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hosts by name…"
              aria-label="Search hosts"
              className="w-full bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
            />
          </div>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size={26} />
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-16 text-center text-ink-500">
                <Users size={28} className="text-ink-300" />
                <p className="text-sm">{query ? `No hosts match "${query}".` : 'No hosts to show yet.'}</p>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((h) => (
                <HostCard key={h.id} host={h} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
