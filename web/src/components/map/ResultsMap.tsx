import { Marker, MapContainer, TileLayer, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Layers, Star } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/currency';
import { listingHeadlinePrice } from '@/lib/pricing';
import { DEFAULT_CENTER, L } from './leaflet';
import { Img } from '@/components/Img';
import { resolvePhoto } from '@/lib/images';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Same free, no-key Esri imagery LocationPicker uses for the host's own pin
// — a renter scanning results benefits from the same "see the actual street"
// option a host gets when placing the pin in the first place.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTR =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

type Plottable = Listing & { lat: number; lng: number };

/**
 * A price-bubble marker, built as a Leaflet `DivIcon` rather than the default
 * pin — nothing like this existed before this component; `LocationMap` only
 * ever draws the default single marker. `active` mirrors the list's hover
 * state, same green/white swap `ListingCard`'s own `isActive` ring uses.
 */
function priceIcon(label: string, active: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="${
      cn(
        'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold shadow-md transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-ink-200 bg-white text-ink-900 hover:border-brand-300',
      )
    }">${label}</div>`,
    iconSize: undefined,
    iconAnchor: [20, 14],
  });
}

/** The AI assistant's own picks get their actual photo on the map, in a
 * brand-ringed circle, instead of a plain price pill — so a renter scanning
 * the map after asking for something can immediately spot which pins are
 * the ones the assistant actually meant, not just the whole result set. */
function photoIcon(photoUrl: string): L.DivIcon {
  // A rounded rectangle, not a circle — a car photo cropped into a circle
  // loses the car; the rectangle keeps enough of the shot to actually
  // recognize it at a glance.
  const width = 60;
  const height = 44;
  // Demo listings store photos as a loremflickr.com/<w>/<h>/<keyword>?lock=<n>
  // *descriptor*, never a fetchable URL — resolvePhoto deterministically maps
  // it to a real, working CDN photo (see web/src/lib/images.ts). This is raw
  // HTML for Leaflet, not JSX, so it can't use the <Img> component the rest
  // of the app relies on for this same resolution — has to happen here.
  const resolved = resolvePhoto(photoUrl);
  return L.divIcon({
    className: '',
    html: `<div style="width:${width}px;height:${height}px" class="overflow-hidden rounded-xl border-[3px] border-brand-600 bg-white shadow-lg ring-2 ring-white"><img src="${resolved}" class="h-full w-full object-cover" /></div>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  });
}

/** A grouped stand-in for several listings that land on the same few
 * pixels — a solid brand-colored count badge, visually distinct from the
 * white price pills so it reads as "zoom in for detail," not another price. */
function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  return L.divIcon({
    className: '',
    html: `<div class="flex items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white shadow-lg ring-1 ring-brand-700/20" style="width:${size}px;height:${size}px;font-size:${count < 100 ? 13 : 11}px">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Re-centers/fits the map when the plottable set changes — a fresh search
 * shouldn't leave the view parked on the previous one's area. Prefers
 * `highlightPoints` when there are any (e.g. the AI assistant's last set of
 * matches) — those are the ones the renter is actually looking at right now,
 * so the map should zoom to where they are rather than staying wide on the
 * full result set they might be buried in. Falls back to `focusPoint` next —
 * a place picked from the pickup search bar, with no picks of its own yet —
 * before finally just fitting whatever's plottable. */
function FitBounds({
  points,
  highlightPoints,
  focusPoint,
}: {
  points: [number, number][];
  highlightPoints: [number, number][];
  focusPoint: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (highlightPoints.length > 0) {
      if (highlightPoints.length === 1) {
        map.setView(highlightPoints[0], 15);
      } else {
        map.fitBounds(highlightPoints, { padding: [40, 40], maxZoom: 15 });
      }
      return;
    }
    if (focusPoint) {
      map.setView(focusPoint, 13);
      return;
    }
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }, [map, points, highlightPoints, focusPoint]);
  return null;
}

/**
 * Groups listings that would land close enough on screen to overlap into a
 * single count badge, and draws individual price pins everywhere else.
 * Clustering runs in screen-pixel space at the map's *current* zoom (via
 * `map.project`), so it only needs to recompute on zoom changes — panning
 * doesn't change how close two points sit to each other on screen. Without
 * this, a popular city (many listings, close coordinates) turns into an
 * unreadable pile of overlapping price bubbles.
 */
function ClusteredMarkers({
  plottable,
  activeId,
  onHover,
  highlightIds,
  onSelect,
}: {
  plottable: Plottable[];
  activeId: string | null;
  onHover: (id: string | null) => void;
  highlightIds: string[];
  onSelect: (listing: Listing) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvent('zoomend', () => setZoom(map.getZoom()));

  // The assistant's own picks never cluster, even when they'd otherwise land
  // within the pixel threshold of something else — they always get plotted
  // as their own marker, so "book this one" always has an actual photo pin
  // to click, not a number badge it happened to get swallowed into. Only the
  // rest of the result set clusters amongst itself.
  const highlightedRaw = useMemo(
    () => plottable.filter((l) => highlightIds.includes(l.id)),
    [plottable, highlightIds],
  );
  // Not clustering them doesn't mean leaving them stacked, though — two
  // listings that share (near enough) the same coordinate would otherwise
  // paint their photo markers directly on top of each other, an unreadable
  // pile instead of one badge. Nudges each collision outward along a
  // golden-angle spiral (the same trick map libraries use for "spiderfying"
  // coincident pins) so every real photo stays visible and clickable, just
  // offset instead of hidden under the one on top.
  const highlighted = useMemo(() => {
    const thresholdPx = 50;
    const placedPoints: ReturnType<typeof map.project>[] = [];
    return highlightedRaw.map((listing) => {
      const raw = map.project([listing.lat, listing.lng], zoom);
      const collisions = placedPoints.filter((p) => p.distanceTo(raw) < thresholdPx).length;
      let point = raw;
      if (collisions > 0) {
        const angle = collisions * 2.4; // golden angle (radians) — even spread, no two ever align
        const radius = 26 * Math.sqrt(collisions);
        point = L.point(raw.x + radius * Math.cos(angle), raw.y + radius * Math.sin(angle));
      }
      placedPoints.push(point);
      const { lat, lng } = map.unproject(point, zoom);
      return { listing, lat, lng };
    });
  }, [highlightedRaw, zoom, map]);
  const clusterable = useMemo(
    () => plottable.filter((l) => !highlightIds.includes(l.id)),
    [plottable, highlightIds],
  );

  const groups = useMemo(() => {
    // Single-linkage clustering by on-screen pixel distance, not a fixed
    // grid — a grid mis-splits two points that straddle a cell boundary
    // even though they're a few pixels apart, which still left overlapping
    // pills in practice. Union-find over pairwise distances doesn't have
    // that edge case; result sets here are small (a page of search results)
    // so the O(n²) pass is cheap.
    const thresholdPx = 46;
    const points = clusterable.map((listing) => map.project([listing.lat, listing.lng], zoom));
    const parent = clusterable.map((_, i) => i);
    function find(i: number): number {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (dx * dx + dy * dy < thresholdPx * thresholdPx) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) parent[ri] = rj;
        }
      }
    }
    const buckets = new Map<number, Plottable[]>();
    clusterable.forEach((listing, i) => {
      const root = find(i);
      const bucket = buckets.get(root);
      if (bucket) bucket.push(listing);
      else buckets.set(root, [listing]);
    });
    return [...buckets.values()];
  }, [clusterable, zoom, map]);

  return (
    <>
      {highlighted.map(({ listing, lat, lng }) => (
        <Marker
          key={listing.id}
          position={[lat, lng]}
          // A listing without a photo yet (host never uploaded one) can't
          // get a photo pin — falls back to the normal price pill, still
          // clickable, rather than an icon with a broken image in it.
          icon={
            listing.photos[0]
              ? photoIcon(listing.photos[0])
              : priceIcon(formatMoney(listingHeadlinePrice(listing).amount, listing.priceCurrency), true)
          }
          eventHandlers={{
            mouseover: () => onHover(listing.id),
            mouseout: () => onHover(null),
            click: () => onSelect(listing),
          }}
        >
          <Tooltip
            direction="top"
            offset={[0, -24]}
            opacity={1}
            className="!rounded-xl !border-0 !bg-transparent !p-0 !shadow-none"
          >
            <div className="w-48 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg">
              <Img
                src={listing.photos[0]}
                alt={listing.title}
                className="h-24 w-full object-cover"
              />
              <div className="p-2">
                <p className="truncate text-xs font-semibold text-ink-900">{listing.title}</p>
                <p className="truncate text-[11px] text-ink-500">{listing.location}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="flex items-center gap-0.5 text-[11px] font-medium text-ink-700">
                    <Star size={11} className="fill-amber-400 text-amber-400" />
                    {listing.ratingAvg.toFixed(1)} ({listing.ratingCount})
                  </span>
                  <span className="text-[11px] font-semibold text-ink-900">
                    {formatMoney(listingHeadlinePrice(listing).amount, listing.priceCurrency)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] font-medium text-brand-600">Click for details →</p>
              </div>
            </div>
          </Tooltip>
        </Marker>
      ))}
      {groups.map((group) => {
        if (group.length === 1) {
          const listing = group[0];
          const price = listingHeadlinePrice(listing);
          const label = formatMoney(price.amount, listing.priceCurrency);
          return (
            <Marker
              key={listing.id}
              position={[listing.lat, listing.lng]}
              icon={priceIcon(label, listing.id === activeId)}
              eventHandlers={{
                mouseover: () => onHover(listing.id),
                mouseout: () => onHover(null),
              }}
            />
          );
        }

        const lat = group.reduce((sum, l) => sum + l.lat, 0) / group.length;
        const lng = group.reduce((sum, l) => sum + l.lng, 0) / group.length;
        const bounds = L.latLngBounds(group.map((l): [number, number] => [l.lat, l.lng]));

        return (
          <Marker
            key={`cluster-${group.map((l) => l.id).join('-')}`}
            position={[lat, lng]}
            icon={clusterIcon(group.length)}
            eventHandlers={{
              click: () => map.fitBounds(bounds, { padding: [60, 60], maxZoom: zoom + 3 }),
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Multi-pin results map — the map half of the AI search page's list+map
 * split. Only plots listings with real coordinates: `lat`/`lng` are nullable
 * on `Listing` (a host who never used the map picker has neither), and today
 * is the first place that has to actually handle that rather than assume
 * every result is plottable the way `LocationMap`'s single-pin callers do.
 * A listing with no coordinates simply doesn't get a pin — it's still in the
 * list, unaffected.
 */
export function ResultsMap({
  listings,
  activeId,
  onHover,
  highlightIds = [],
  onSelect,
  focusPoint = null,
  className,
}: {
  listings: Listing[];
  activeId: string | null;
  onHover: (id: string | null) => void;
  /** Cars to mark as selected regardless of hover — e.g. the AI assistant's
   * last set of matches. */
  highlightIds?: string[];
  /** Clicking one of the highlighted (photo) markers — starts a booking
   * request for it in the assistant. No-op if omitted, e.g. on a page that
   * doesn't have the assistant wired up. */
  onSelect?: (listing: Listing) => void;
  /** A place picked from the pickup search bar's autocomplete — pans/zooms
   * the map there. Only takes effect when there's nothing more specific
   * (highlighted matches) already claiming the view — see FitBounds. */
  focusPoint?: { lat: number; lng: number } | null;
  className?: string;
}) {
  const [satellite, setSatellite] = useState(false);
  const plottable = listings.filter(
    (l): l is Plottable => l.lat != null && l.lng != null,
  );
  const points: [number, number][] = plottable.map((l) => [l.lat, l.lng]);
  const highlightPoints: [number, number][] = plottable
    .filter((l) => highlightIds.includes(l.id))
    .map((l) => [l.lat, l.lng]);
  const center = points[0] ?? [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

  return (
    <div className={cn('relative h-full w-full', className)}>
      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        className="absolute right-2.5 top-2.5 z-[1000] flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 shadow-md hover:bg-ink-50"
      >
        <Layers size={14} />
        {satellite ? 'Map view' : 'Satellite'}
      </button>
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="h-full w-full">
        {satellite ? (
          <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTR} maxNativeZoom={19} />
        ) : (
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        )}
        <FitBounds
          points={points}
          highlightPoints={highlightPoints}
          focusPoint={focusPoint ? [focusPoint.lat, focusPoint.lng] : null}
        />
        <ClusteredMarkers
          plottable={plottable}
          activeId={activeId}
          onHover={onHover}
          highlightIds={highlightIds}
          onSelect={onSelect ?? (() => {})}
        />
      </MapContainer>
    </div>
  );
}
