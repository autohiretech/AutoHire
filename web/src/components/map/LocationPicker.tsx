import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LeafletEvent } from 'leaflet';
import { MapPin, Navigation } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useAddressSuggestions, type AddressSuggestion } from '@/lib/geocoding';
import { DEFAULT_CENTER, L } from './leaflet';
import './leaflet';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Esri's World Imagery — free, no API key, no usage cap that matters at this
// scale. Lets a host actually see their driveway/gate rather than guessing
// against a schematic street map, which is the real gap a mapping *library*
// swap (Mapbox included) doesn't close on its own — both draw a pin exactly
// as precisely as the other; only the imagery underneath differs.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTR =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Looks up the address for a raw coordinate — used whenever a pin is set by
 * a means that has no address attached yet (current location, a map click, a
 * drag), so the Pickup area text still gets written automatically instead of
 * being left for the host to type by hand. */
async function reverseGeocode(p: LatLng): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${p.lat}&lon=${p.lng}`,
      { headers: { 'Accept-Language': 'en' } },
    );
    const hit = (await res.json()) as { display_name?: string };
    return hit.display_name ?? null;
  } catch {
    return null;
  }
}

/** Captures map clicks and reports the dropped point. */
function ClickToPlace({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** Pans (and, the first time a point appears, zooms in close) to follow the
 * chosen point — e.g. after picking a suggestion or dropping a pin. A wide
 * city-level zoom is useless for confirming an exact pickup spot, so this
 * jumps to street level the moment there's a point worth looking at, then
 * leaves the host's own zooming alone after that. */
function Recenter({ pos }: { pos: LatLng }) {
  const map = useMap();
  const hasZoomedIn = useRef(false);
  useEffect(() => {
    if (!hasZoomedIn.current) {
      hasZoomedIn.current = true;
      map.setView([pos.lat, pos.lng], 18);
    } else {
      map.panTo([pos.lat, pos.lng]);
    }
  }, [map, pos.lat, pos.lng]);
  return null;
}

/**
 * Interactive pickup-location picker. Type to get live address suggestions
 * (a booking-app-style dropdown, not a "type and press search" round trip),
 * pick "Use my current location", click the map to drop the pin, or drag the
 * pin afterward to fine-tune it. Whichever way the pin lands, both the
 * coordinate and its address are reported — `onChange` always fires, and
 * `onAddress` fires too (via reverse-geocoding when the address isn't
 * already known, e.g. a click or drag), so the host never has to type the
 * address by hand just because they placed the pin some other way.
 */
export function LocationPicker({
  value,
  onChange,
  onAddress,
}: {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  onAddress?: (address: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const center = value ?? DEFAULT_CENTER;
  const { suggestions, searching } = useAddressSuggestions(query);

  // Click-away closes the dropdown.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Single funnel for "a pin landed here" regardless of how — a search pick
  // (address already known), current-location, a map click, or a drag (both
  // need a reverse-geocode lookup). Every path ends up writing both the
  // coordinate and the address text, so Pickup area never needs to be typed
  // by hand.
  async function applyPoint(p: LatLng, knownLabel?: string) {
    onChange(p);
    const label = knownLabel ?? (await reverseGeocode(p));
    if (label) {
      setQuery(label);
      onAddress?.(label);
    }
  }

  function pick(s: AddressSuggestion) {
    void applyPoint({ lat: s.lat, lng: s.lng }, s.label);
    setOpen(false);
    setError(null);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('Location access is not available on this device.');
      return;
    }
    setLocating(true);
    setOpen(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        // Immediate feedback while the reverse-geocode is still in flight —
        // applyPoint below replaces this with the real address once it lands.
        setQuery(`Current location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
        setError(null);
        void applyPoint(p).finally(() => setLocating(false));
      },
      () => {
        setError("Couldn't get your location — search or click the map instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="space-y-2">
      {/* A plain div, not a <form> — this sits inside the listing <form>. */}
      <div ref={boxRef} className="relative">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (suggestions[0]) pick(suggestions[0]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Precise address, area, or landmark…"
          />
          <Button type="button" variant="outline" onClick={() => setSatellite((v) => !v)}>
            {satellite ? 'Map view' : 'Satellite'}
          </Button>
        </div>
        {open && (
          <div className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-200 bg-white shadow-lg">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={useCurrentLocation}
              disabled={locating}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 disabled:opacity-60"
            >
              <Navigation className="h-4 w-4 shrink-0 text-brand-600" />
              {locating ? 'Finding you…' : 'Use my current location'}
            </button>
            {searching && <div className="border-t border-ink-100 px-3 py-2 text-xs text-ink-400">Searching…</div>}
            {suggestions.map((s, i) => (
              <button
                key={`${s.lat},${s.lng},${i}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="flex w-full items-start gap-2 border-t border-ink-100 px-3 py-2 text-left text-sm hover:bg-ink-50"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                <span>{s.label}</span>
              </button>
            ))}
            {!searching && query.trim().length >= 3 && suggestions.length === 0 && (
              <div className="border-t border-ink-100 px-3 py-2 text-xs text-ink-400">
                No place found — try a different search, or click the map.
              </div>
            )}
          </div>
        )}
      </div>
      <MapContainer center={[center.lat, center.lng]} zoom={13} className="h-56 w-full rounded-lg">
        {satellite ? (
          <TileLayer url={SATELLITE_URL} attribution={SATELLITE_ATTR} maxNativeZoom={19} />
        ) : (
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        )}
        <ClickToPlace onPick={(p) => void applyPoint(p)} />
        {value && (
          <Marker
            position={[value.lat, value.lng]}
            draggable
            eventHandlers={{
              dragend: (e: LeafletEvent) => {
                const marker = e.target as L.Marker;
                const { lat, lng } = marker.getLatLng();
                void applyPoint({ lat, lng });
              },
            }}
          />
        )}
        {value && <Recenter pos={value} />}
      </MapContainer>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-ink-400">
        {value
          ? `Pin set at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)} — drag it to fine-tune.`
          : 'Search, pick your current location, or click the map to drop the pickup pin.'}
      </p>
    </div>
  );
}
