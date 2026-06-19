import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { cn } from '@/lib/cn';
import './leaflet';

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Read-only map showing a single pickup pin. */
export function LocationMap({
  lat,
  lng,
  className,
  zoom = 14,
}: {
  lat: number;
  lng: number;
  className?: string;
  zoom?: number;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={zoom}
      scrollWheelZoom={false}
      className={cn('h-48 w-full rounded-lg', className)}
    >
      <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
      <Marker position={[lat, lng]} />
    </MapContainer>
  );
}
