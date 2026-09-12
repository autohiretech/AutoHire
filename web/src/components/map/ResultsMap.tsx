import { Marker, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Star, ZoomIn } from 'lucide-react';
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

/** Marker HTML is a raw string handed to Leaflet, not JSX, so anything
 * interpolated into it has to be escaped by hand — a car titled
 * `Fendt "Vario" e100` would otherwise close the attribute it sits in. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A price-bubble marker, built as a Leaflet `DivIcon` rather than the default
 * pin — nothing like this existed before this component; `LocationMap` only
 * ever draws the default single marker. `active` mirrors the list's hover
 * state, same green/white swap `ListingCard`'s own `isActive` ring uses.
 *
 * `spotlit` is the middle tier between this and a full card: a match the
 * assistant is actually answering with, which didn't have room for its card
 * at this zoom (see `placeMarkers`). It keeps the accent colouring so the
 * renter can still tell it apart from the rest of the result set, and grows
 * into its card as soon as zooming gives it the space.
 */
function priceIcon(label: string, active: boolean, spotlit = false): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="${
      cn(
        'whitespace-nowrap rounded-[var(--radius-pill)] border px-2.5 py-1 text-caption font-semibold shadow-[var(--shadow-float)] transition-colors',
        active
          ? 'border-[var(--color-accent-on)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
          : spotlit
            ? 'border-[var(--color-accent-on)] bg-[var(--color-surface-raised)] text-[var(--color-accent-on)]'
            : 'border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content)] hover:border-[var(--color-accent-on)]',
      )
    }">${esc(label)}</div>`,
    iconSize: undefined,
    iconAnchor: [20, 14],
  });
}

/** Card-marker geometry, in screen pixels. `placeMarkers` reserves this much
 * room per card before it agrees to draw one, so cards never overlap each
 * other; the pill numbers do the same job one tier down. */
const CARD_W = 208;
const CARD_H = 56;
const PILL_W = 74;
const PILL_H = 26;
/** Breathing room between two placed markers — touching boxes read as one
 * smeared object even when they technically don't overlap. */
const GUTTER = 6;

/**
 * The assistant's own matches get a **card** on the map, not a pin: photo,
 * name, price and rating, the same four things the list card leads with.
 *
 * A price bubble answers "how much is the thing here"; after asking for "a
 * tractor for cultivating" the renter's question is "which ones are these",
 * and a number badge can't answer that — the whole result set arrived as
 * anonymous clusters and the cars were only visible by looking away from the
 * map, at the list. So the answers themselves sit on the map now.
 */
function cardIcon(listing: Plottable, active: boolean, extras: number): L.DivIcon {
  const price = listingHeadlinePrice(listing);
  const amount = formatMoney(price.amount, listing.priceCurrency);
  const rating = listing.ratingAvg ? listing.ratingAvg.toFixed(1) : '—';
  // Demo listings store photos as a loremflickr.com/<w>/<h>/<keyword>?lock=<n>
  // *descriptor*, never a fetchable URL — resolvePhoto deterministically maps
  // it to a real, working CDN photo (see web/src/lib/images.ts). This is raw
  // HTML for Leaflet, not JSX, so it can't use the <Img> component the rest
  // of the app relies on for this same resolution — has to happen here.
  const photo = listing.photos[0] ? resolvePhoto(listing.photos[0]) : null;
  const thumb = photo
    ? `<img src="${esc(photo)}" alt="" class="h-11 w-14 shrink-0 rounded-[var(--radius-control)] object-cover" />`
    : '';
  // "+5" — the cars sharing this spot that the card is standing in for. A
  // depot with six machines on one coordinate is one marker however far you
  // zoom, so the marker has to admit to the other five rather than quietly
  // hide them behind the one it drew.
  const more =
    extras > 0
      ? `<span class="absolute -right-1.5 -top-1.5 rounded-[var(--radius-pill)] border-2 border-[var(--color-surface-raised)] bg-[var(--color-accent-on)] px-1.5 text-[10px] font-bold leading-4 text-[var(--color-accent-contrast)]">+${extras}</span>`
      : '';
  return L.divIcon({
    className: '',
    html: `<div style="width:${CARD_W}px" class="${
      cn(
        'relative flex items-center gap-2 rounded-[var(--radius-card)] border-2 bg-[var(--color-surface-raised)] p-1.5 shadow-[var(--shadow-float)] transition-colors',
        active
          ? 'border-[var(--color-accent-on)] ring-2 ring-[var(--color-accent-on)]/30'
          : 'border-[var(--color-accent-on)]',
      )
    }">${more}${thumb}<div class="min-w-0 flex-1">
        <div class="truncate text-[12px] font-semibold leading-tight text-[var(--color-content)]">${esc(listing.title)}</div>
        <div class="mt-0.5 flex items-baseline justify-between gap-1">
          <span class="tabular truncate text-[12px] font-bold text-[var(--color-content)]">${esc(amount)}<span class="text-[10px] font-medium text-[var(--color-content-muted)]"> /${esc(price.unit)}</span></span>
          <span class="tabular shrink-0 text-[11px] font-medium text-[var(--color-content-muted)]">★ ${esc(rating)}</span>
        </div>
      </div></div>`,
    iconSize: [CARD_W, CARD_H],
    iconAnchor: [CARD_W / 2, CARD_H / 2],
  });
}

/** A grouped stand-in for several listings that land on the same few
 * pixels — a solid brand-colored count badge, visually distinct from the
 * white price pills so it reads as "zoom in for detail," not another price. */
function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  return L.divIcon({
    className: '',
    html: `<div class="flex items-center justify-center rounded-[var(--radius-pill)] border-2 border-[var(--color-surface-raised)] bg-[var(--color-accent-on)] font-bold text-[var(--color-accent-contrast)] shadow-[var(--shadow-float)]" style="width:${size}px;height:${size}px;font-size:${count < 100 ? 13 : 11}px">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Leaflet's own popup chrome — white box, 13px/19px margins, a tip, a close
 * "×" — fights every surface token in the app, so the wrapper is stripped
 * flat and the card inside owns the entire look. `!` beats the width Leaflet
 * writes inline on `.leaflet-popup-content` while measuring. */
const POPUP_RESET = cn(
  '[&_.leaflet-popup-content-wrapper]:!bg-transparent [&_.leaflet-popup-content-wrapper]:!p-0',
  '[&_.leaflet-popup-content-wrapper]:!shadow-none [&_.leaflet-popup-content-wrapper]:![border-radius:0]',
  '[&_.leaflet-popup-content]:!m-0 [&_.leaflet-popup-content]:!w-auto',
  '[&_.leaflet-popup-tip-container]:!hidden',
);

/** The full card behind a marker click: everything the list card shows, and
 * a way through to the car itself. Pins were previously click-dead outside
 * the assistant's own matches — a price with no way to find out what it was
 * the price of. */
function MapCard({ listing }: { listing: Plottable }) {
  const price = listingHeadlinePrice(listing);
  return (
    <div className="w-[240px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
      <Link to={`/cars/${listing.id}`} className="block">
        <Img src={listing.photos[0] ?? ''} alt={listing.title} className="h-[124px] w-full object-cover" />
      </Link>
      <div className="p-2.5">
        <Link
          to={`/cars/${listing.id}`}
          className="block truncate text-body-sm font-semibold text-[var(--color-content)] hover:underline"
        >
          {listing.title}
        </Link>
        <p className="mt-0.5 flex items-center gap-1 text-caption text-[var(--color-content-muted)]">
          <Star size={11} className="fill-[var(--color-accent-on)] text-[var(--color-accent-on)]" />
          <span className="tabular">
            {listing.ratingAvg ? listing.ratingAvg.toFixed(1) : '—'} ({listing.ratingCount})
          </span>
          <span className="truncate">· {listing.year}</span>
        </p>
        <p className="truncate text-caption text-[var(--color-content-muted)]">{listing.location}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="tabular text-body-sm font-semibold text-[var(--color-content)]">
            {formatMoney(price.amount, listing.priceCurrency)}
            <span className="font-normal text-[var(--color-content-muted)]"> / {price.unit}</span>
          </span>
          <Link
            to={`/cars/${listing.id}`}
            className="shrink-0 rounded-[var(--radius-control)] bg-[var(--color-accent-on)] px-2.5 py-1 text-caption font-semibold text-[var(--color-accent-contrast)]"
          >
            View car
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * What a cluster opens into. Clicking a count badge used to only ever call
 * `fitBounds`, which is a dead click for the case that produces most
 * clusters in this catalogue — several cars at one depot, on coordinates
 * close enough that no zoom level ever separates them. The badge now says
 * what it's hiding, and zooming is the secondary action it offers when
 * zooming would actually achieve something.
 */
function ClusterCard({
  group,
  onHover,
  canZoom,
  onZoom,
}: {
  group: Plottable[];
  onHover: (id: string | null) => void;
  canZoom: boolean;
  onZoom: () => void;
}) {
  return (
    <div className="w-[264px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <span className="text-caption font-semibold text-[var(--color-content)]">
          {group.length} cars here
        </span>
        {canZoom && (
          <button
            type="button"
            onClick={onZoom}
            className="flex items-center gap-1 text-caption font-medium text-[var(--color-accent-on)]"
          >
            <ZoomIn size={12} />
            Zoom in
          </button>
        )}
      </div>
      <div className="max-h-[232px] overflow-y-auto">
        {group.map((l) => {
          const price = listingHeadlinePrice(l);
          return (
            <Link
              key={l.id}
              to={`/cars/${l.id}`}
              onMouseEnter={() => onHover(l.id)}
              onMouseLeave={() => onHover(null)}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--color-surface-sunken)]"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Img src={l.photos?.[0] ?? ''} alt="" className="h-10 w-12 shrink-0 rounded-[var(--radius-control)] object-cover" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-caption font-semibold text-[var(--color-content)]">{l.title}</span>
                  <span className="tabular truncate text-[11px] text-[var(--color-content-muted)]">
                    ★ {l.ratingAvg ? l.ratingAvg.toFixed(1) : '—'} · {formatMoney(price.amount, l.priceCurrency)} / {price.unit}
                  </span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** The compact hover card a price pill gets — a pill shows a number and
 * nothing else, so hovering it has to answer "of what". Cards need no such
 * thing: they already are the answer. */
function PinTooltip({ listing }: { listing: Plottable }) {
  return (
    <Tooltip
      direction="top"
      offset={[0, -18]}
      opacity={1}
      className="![border-radius:var(--radius-card)] !border-0 !bg-transparent !p-0 !shadow-none"
    >
      <div className="w-48 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
        <Img src={listing.photos[0] ?? ''} alt={listing.title} className="h-24 w-full object-cover" />
        <div className="p-2">
          <p className="truncate text-caption font-semibold text-[var(--color-content)]">{listing.title}</p>
          <p className="truncate text-[11px] text-[var(--color-content-muted)]">{listing.location}</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="tabular flex items-center gap-0.5 text-[11px] font-medium text-[var(--color-content-muted)]">
              <Star size={11} className="fill-[var(--color-accent-on)] text-[var(--color-accent-on)]" />
              {listing.ratingAvg.toFixed(1)} ({listing.ratingCount})
            </span>
            <span className="tabular text-[11px] font-semibold text-[var(--color-content)]">
              {formatMoney(listingHeadlinePrice(listing).amount, listing.priceCurrency)}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-[var(--color-accent-on)]">Click for details →</p>
        </div>
      </div>
    </Tooltip>
  );
}

/**
 * Re-centers/fits the map when the plottable set changes — a fresh search
 * shouldn't leave the view parked on the previous one's area. Prefers
 * `highlightPoints` when there are any (e.g. the AI assistant's last set of
 * matches) — those are the ones the renter is actually looking at right now,
 * so the map should zoom to where they are rather than staying wide on the
 * full result set they might be buried in. Falls back to `focusPoint` next —
 * a place picked from the pickup search bar, with no picks of its own yet —
 * before finally just fitting whatever's plottable.
 *
 * `key` is what the effect actually watches. The two arrays are rebuilt on
 * every render, so depending on them directly re-ran this on every render —
 * including the ones caused by nothing but hovering a card, which yanked the
 * map back to the fitted view mid-pan. The key changes only when the set of
 * plotted cars really does.
 */
function FitBounds({
  points,
  highlightPoints,
  focusPoint,
  fitKey,
}: {
  points: [number, number][];
  highlightPoints: [number, number][];
  focusPoint: [number, number] | null;
  fitKey: string;
}) {
  const map = useMap();
  useEffect(() => {
    if (highlightPoints.length > 0) {
      if (highlightPoints.length === 1) {
        map.setView(highlightPoints[0], 15);
      } else {
        map.fitBounds(highlightPoints, { padding: [60, 60], maxZoom: 15 });
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
    // Everything the effect reads is derived from `fitKey`; see the note above
    // for why the arrays themselves can't be the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

/** One drawn marker and the cars it stands for. `extras` are the ones whose
 * own marker would have landed on top of this one — they aren't dropped, they
 * ride along and come back out of the popup. */
type Placement = {
  lead: Plottable;
  /** Card when the lead is one of the assistant's matches and the space was
   * free; pill otherwise. A placement with extras draws as a count badge
   * (pill) or a card wearing a "+N" chip. */
  kind: 'card' | 'pill';
  extras: Plottable[];
  x: number;
  y: number;
};

/**
 * Lays the whole result set out in screen space in one priority-ordered pass,
 * giving each car the biggest marker that still fits: a card for the
 * assistant's matches, a price pill for the rest, and — for whatever has no
 * room left at this zoom — a seat inside the nearest marker already placed,
 * which becomes a count badge or a card with a "+N" chip.
 *
 * Doing this in one pass is the point. Placing cards, then pills, then
 * clustering the remainder independently drew all three on the same
 * coordinate: a depot's six machines became a card with five invisible badges
 * stacked underneath it. Nothing is drawn here without first reserving the
 * pixels it needs, and anything that can't reserve them joins something that
 * did.
 */
function placeAll(
  plottable: Plottable[],
  spotlit: Set<string>,
  project: (lat: number, lng: number) => { x: number; y: number },
): Placement[] {
  // The assistant's matches first, then the rest in ranking order.
  //
  // Deliberately *not* influenced by what the renter is hovering. Letting the
  // active car jump the queue re-laid the whole map out on every hover: pins
  // moved under the cursor, and a marker could change which cars it stood for
  // between being pointed at and being clicked — click a pill reading
  // "RF 230,000" and a two-car list opens. Hover is a paint, not a layout:
  // whichever marker holds the active car lights up where it already is.
  const order = [...plottable].sort((a, b) => {
    const rank = (l: Plottable) => (spotlit.has(l.id) ? 0 : 1);
    return rank(a) - rank(b);
  });

  const placed: Placement[] = [];
  const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];

  const fits = (x: number, y: number, w: number, h: number) => {
    const box = {
      x1: x - w / 2 - GUTTER,
      y1: y - h / 2 - GUTTER,
      x2: x + w / 2 + GUTTER,
      y2: y + h / 2 + GUTTER,
    };
    const clash = boxes.some(
      (t) => box.x1 < t.x2 && box.x2 > t.x1 && box.y1 < t.y2 && box.y2 > t.y1,
    );
    return clash ? null : box;
  };

  for (const listing of order) {
    const { x, y } = project(listing.lat, listing.lng);
    const wantsCard = spotlit.has(listing.id);
    const cardBox = wantsCard ? fits(x, y, CARD_W, CARD_H) : null;
    if (cardBox) {
      boxes.push(cardBox);
      placed.push({ lead: listing, kind: 'card', extras: [], x, y });
      continue;
    }
    const pillBox = fits(x, y, PILL_W, PILL_H);
    if (pillBox) {
      boxes.push(pillBox);
      placed.push({ lead: listing, kind: 'pill', extras: [], x, y });
      continue;
    }
    // No room at this zoom — ride along with whichever marker is nearest,
    // which is one of the markers actually covering this spot.
    let nearest = placed[0];
    let best = Infinity;
    for (const p of placed) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    if (nearest) nearest.extras.push(listing);
  }
  return placed;
}

/**
 * Draws the result set at three levels of detail, decided per marker at the
 * current zoom rather than per result set:
 *
 * 1. **Cards** for the assistant's matches (`highlightIds`) that have room —
 *    photo, name, price, rating, the same four things the list card leads
 *    with, so an answer can be read off the map instead of beside it.
 * 2. **Price pills** for everything else that has room, accent-coloured when
 *    they're a match that couldn't fit its card at this zoom.
 * 3. **Count badges** wherever cars pile onto one spot — a depot with six
 *    machines on one coordinate, which no zoom level ever separates.
 *
 * Every marker opens into cards on click: one car's, or the list of the ones
 * sharing its spot. Positions come from `map.project` at the current zoom, so
 * this only recomputes on zoom — panning doesn't change how close two points
 * sit to each other on screen — and zooming in promotes markers up the tiers
 * as space appears, which is what makes the zoom worth doing.
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
  onSelect?: (listing: Listing) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvent('zoomend', () => setZoom(map.getZoom()));

  const project = useCallback(
    (lat: number, lng: number) => map.project([lat, lng], zoom),
    [map, zoom],
  );

  const spotlit = useMemo(() => new Set(highlightIds), [highlightIds]);
  const placements = useMemo(
    () => placeAll(plottable, spotlit, project),
    [plottable, spotlit, project],
  );

  const maxZoom = map.getMaxZoom();

  return (
    <>
      {placements.map((placement) => {
        const { lead, kind, extras } = placement;
        const group = [lead, ...extras];
        const price = listingHeadlinePrice(lead);
        const label = formatMoney(price.amount, lead.priceCurrency);
        const isActive = group.some((l) => l.id === activeId);

        // A pill standing for several cars is the familiar count badge; a
        // card says it with a "+N" chip instead, because the card itself is
        // still worth showing.
        const icon =
          kind === 'card'
            ? cardIcon(lead, isActive, extras.length)
            : extras.length > 0
              ? clusterIcon(group.length)
              : priceIcon(label, isActive, spotlit.has(lead.id));

        // Zooming only helps when the group actually spreads out further in.
        // Several cars at one depot share a coordinate to the metre and never
        // separate however far you go — offering "zoom in" there sends the
        // renter down a hole with the same badge at the bottom.
        const spreadAtMaxZoom = (() => {
          if (extras.length === 0) return 0;
          const pts = group.map((l) => map.project([l.lat, l.lng], maxZoom));
          let span = 0;
          for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
              span = Math.max(span, pts[i].distanceTo(pts[j]));
            }
          }
          return span;
        })();
        const bounds = L.latLngBounds(group.map((l): [number, number] => [l.lat, l.lng]));

        return (
          <Marker
            key={lead.id}
            position={[lead.lat, lead.lng]}
            icon={icon}
            // A card is a wide object; whichever marker the renter is
            // pointing at has to sit above its neighbours, not under them.
            zIndexOffset={isActive ? 1000 : kind === 'card' ? 500 : 0}
            eventHandlers={{
              mouseover: () => onHover(lead.id),
              mouseout: () => onHover(null),
              click: () => onSelect?.(lead),
              // Clicking a pin means the cursor is on it, so its hover card
              // would otherwise sit there beside the popup saying a quieter
              // version of the same thing.
              popupopen: (e) => e.target.closeTooltip(),
            }}
          >
            {/* A pill shows a number and nothing else, so hovering it has to
                answer "of what". Cards need no such thing — they already are
                the answer — and a badge's hover would be a lie about which
                of its cars it described. */}
            {kind === 'pill' && extras.length === 0 && <PinTooltip listing={lead} />}
            <Popup
              closeButton={false}
              offset={[0, kind === 'card' ? -30 : -16]}
              className={POPUP_RESET}
              autoPanPadding={[24, 24]}
            >
              {extras.length > 0 ? (
                <ClusterCard
                  group={group}
                  onHover={onHover}
                  canZoom={zoom < maxZoom && spreadAtMaxZoom > PILL_W}
                  onZoom={() => {
                    map.closePopup();
                    map.fitBounds(bounds, {
                      padding: [60, 60],
                      maxZoom: Math.min(maxZoom, zoom + 3),
                    });
                  }}
                />
              ) : (
                <MapCard listing={lead} />
              )}
            </Popup>
          </Marker>
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
  /** Cars to draw as full cards rather than price pins — e.g. the ones the
   * assistant is answering with. */
  highlightIds?: string[];
  /** Clicking a marker's card — starts a booking request for it in the
   * assistant. Omitted on pages with no assistant wired up, where the card
   * offers a link to the car's own page instead. */
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
  // Identity of the *set*, not of the arrays — see FitBounds.
  const fitKey = `${plottable.map((l) => l.id).join(',')}|${highlightIds.join(',')}|${
    focusPoint ? `${focusPoint.lat},${focusPoint.lng}` : ''
  }`;

  return (
    <div className={cn('relative h-full w-full', className)}>
      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        className="absolute right-2.5 top-2.5 z-[1000] flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-2.5 py-1.5 text-caption font-medium text-[var(--color-content)] shadow-[var(--shadow-float)] hover:bg-[var(--color-surface-sunken)]"
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
          fitKey={fitKey}
        />
        <ClusteredMarkers
          plottable={plottable}
          activeId={activeId}
          onHover={onHover}
          highlightIds={highlightIds}
          onSelect={onSelect}
        />
      </MapContainer>
    </div>
  );
}
