import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * The Cars / Hosts / Cities switcher — rendered at the top of every
 * browse-root page (home, the hosts directory, the cities list) so switching
 * sections is one click from anywhere instead of navigating back to "/" first.
 * Plain `<Link>`s driven by the current route, so the active pill always
 * matches where you actually are, including on a host's profile or a city's
 * car list (still "in" that section, just one level deeper).
 *
 * Used to carry a fourth pill, "AI Mode", linking to `/?view=ai` — retired
 * along with `AiMode.tsx` once the AI search page (`/search`) replaced it as
 * the only search experience rather than a toggle alongside the plain one.
 */
export function BrowseTabs() {
  const { pathname } = useLocation();
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
      <nav className="flex items-center gap-1 rounded-full border border-ink-200 bg-white p-1 shadow-sm">
        <Link to="/" className={cn(pill, section === 'cars' ? active : inactive)}>
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
