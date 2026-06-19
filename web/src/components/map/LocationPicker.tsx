import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Button, Input } from '@/components/ui';
import { DEFAULT_CENTER } from './leaflet';
import './leaflet';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface LatLng {
  lat: number;
  lng: number;
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

/** Pans the map to follow the chosen point (e.g. after an address search). */
function Recenter({ pos }: { pos: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([pos.lat, pos.lng]);
  }, [map, pos.lat, pos.lng]);
  return null;
}

/**
 * Interactive pickup-location picker. Search an address (OpenStreetMap's free
 * Nominatim geocoder) or click the map to drop the pin. Reports coordinates via
 * `onChange` and the matched address text via `onAddress`.
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
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const center = value ?? DEFAULT_CENTER;

  async function search(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        { headers: { 'Accept-Language': 'en' } },
      );
      const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if (!hits.length) {
        setError('No place found — try a different search, or click the map.');
        return;
      }
      const p = { lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
      onChange(p);
      onAddress?.(hits[0].display_name);
    } catch {
      setError('Search failed — click the map to drop the pin instead.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={search} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a place or address"
        />
        <Button type="button" variant="outline" onClick={search} disabled={searching}>
          {searching ? '…' : 'Search'}
        </Button>
      </form>
      <MapContainer center={[center.lat, center.lng]} zoom={13} className="h-56 w-full rounded-lg">
        <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        <ClickToPlace onPick={onChange} />
        {value && <Marker position={[value.lat, value.lng]} />}
        {value && <Recenter pos={value} />}
      </MapContainer>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-ink-400">
        {value
          ? `Pin set at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}.`
          : 'Search, or click the map to drop the pickup pin.'}
      </p>
    </div>
  );
}
