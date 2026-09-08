import { ExternalLink, Navigation } from 'lucide-react';
import { directionsUrl } from '@/lib/location';

const linkClass =
  'inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-1.5 text-body-sm font-medium text-[var(--color-content-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]';

/**
 * Outbound location links: the host's own "location link" (directions / arrival
 * instructions) and an auto "Get directions" to the map pin.
 */
export function LocationLinks({
  url,
  lat,
  lng,
}: {
  url?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const hasPin = lat != null && lng != null;
  if (!url && !hasPin) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {url && (
        <a href={url} target="_blank" rel="noreferrer noopener" className={linkClass}>
          <ExternalLink size={15} className="text-[var(--color-accent-on)]" /> Open location link
        </a>
      )}
      {hasPin && (
        <a
          href={directionsUrl(lat as number, lng as number)}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          <Navigation size={15} className="text-[var(--color-accent-on)]" /> Get directions
        </a>
      )}
    </div>
  );
}
