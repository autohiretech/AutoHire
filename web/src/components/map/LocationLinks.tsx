import { ExternalLink, Navigation } from 'lucide-react';
import { directionsUrl } from '@/lib/location';

const linkClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50';

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
          <ExternalLink size={15} className="text-brand-600" /> Open location link
        </a>
      )}
      {hasPin && (
        <a
          href={directionsUrl(lat as number, lng as number)}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          <Navigation size={15} className="text-brand-600" /> Get directions
        </a>
      )}
    </div>
  );
}
