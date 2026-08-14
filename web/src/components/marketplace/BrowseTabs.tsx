import { Link, useLocation } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The Cars / Hosts / Cities / AI Mode switcher — rendered at the top of every
 * browse-root page (home, the hosts directory, the cities list) so switching
 * sections is one click from anywhere instead of navigating back to "/" first.
 * Plain `<Link>`s driven by the current route, so the active pill always
 * matches where you actually are, including on a host's profile or a city's
 * car list (still "in" that section, just one level deeper).
 */
export function BrowseTabs() {
  const { pathname, search } = useLocation();
  const aiMode = pathname === '/' && new URLSearchParams(search).get('view') === 'ai';
  const section: 'cars' | 'hosts' | 'cities' | null =
    pathname === '/'
      ? 'cars'
      : pathname.startsWith('/hosts')
        ? 'hosts'
        : pathname.startsWith('/cities')
          ? 'cities'
          : null;

  const pill = 'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors';
  const active = 'bg-brand-600 text-white shadow-sm';
  const inactive = 'text-ink-600 hover:bg-ink-50';

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Link
        to="/?view=ai"
        className={cn(
          'flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
          aiMode ? 'bg-accent-50 text-accent-700' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
        )}
      >
        <Sparkles size={16} className={aiMode ? 'text-accent-500' : 'text-accent-400'} /> AI Mode
      </Link>
      <span className="hidden h-6 w-px bg-ink-200 sm:block" />
      <nav className="flex items-center gap-1 rounded-full border border-ink-200 bg-white p-1 shadow-sm">
        <Link to="/" className={cn(pill, section === 'cars' && !aiMode ? active : inactive)}>
          Cars
        </Link>
        <Link to="/hosts" className={cn(pill, section === 'hosts' ? active : inactive)}>
          Hosts
        </Link>
        <Link to="/cities" className={cn(pill, section === 'cities' ? active : inactive)}>
          Cities
        </Link>
      </nav>
    </div>
  );
}
