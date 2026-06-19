// Shared Leaflet setup: loads the CSS once and fixes the default marker icon,
// whose image paths break under bundlers (Vite) unless wired up explicitly.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

/** Kigali — default map centre when a listing has no coordinates yet. */
export const DEFAULT_CENTER = { lat: -1.9441, lng: 30.0619 };

export { L };
