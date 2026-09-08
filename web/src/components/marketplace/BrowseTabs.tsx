import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { ChipRow } from '@/components/ui';

/**
 * The Cars / Hosts / Cities switcher — rendered at the top of every
 * browse-root page (home, the hosts directory, the cities list) so switching
 * sections is one click from anywhere instead of navigating back to "/" first.
 * Plain `<Link>`s driven by the current route, so the active pill always
 * matches where you actually are, including on a host's profile or a city's
 * car list (still "in" that section, just one level deeper).
 *
 * Styled to match `Chip` exactly (fill + weight for the active state, not
 * hue — a green tab here would spend the page's one accent on navigation
 * chrome) but rendered as `<Link>`s rather than `<button>`s, so it can't
 * reuse the component directly.
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

  const tab = (active: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] px-3.5',
      'text-body-sm font-semibold whitespace-nowrap transition-colors duration-150',
      active
        ? 'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
        : 'border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
    );

  return (
    <ChipRow className="justify-center">
      <Link to="/" className={tab(section === 'cars')}>
        Cars
      </Link>
      <Link to="/hosts" className={tab(section === 'hosts')}>
        Hosts
      </Link>
      <Link to="/cities" className={tab(section === 'cities')}>
        Cities
      </Link>
    </ChipRow>
  );
}
