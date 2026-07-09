import {
  Bus,
  Car,
  CarFront,
  Caravan,
  Construction,
  Forklift,
  Gem,
  Mountain,
  Sprout,
  Tractor,
  Truck,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import type { CarCategory } from '@autohire/shared';

/** Top-level catalogue groups: road vehicles vs rentable machinery. */
export type CategoryGroup = 'Vehicles' | 'Cultivating' | 'Building';

/**
 * Browseable categories with a label, icon and group, shared by the home
 * category sidebar, the search filters and the listing form. Machinery
 * (cultivating + building) sits alongside vehicles — all rent through the same
 * flow. Keep in sync with the `car_category` DB enum (migration-025).
 */
export const CAR_CATEGORIES: {
  value: CarCategory;
  label: string;
  icon: LucideIcon;
  group: CategoryGroup;
}[] = [
  // Vehicles
  { value: 'sedan', label: 'Sedan', icon: Car, group: 'Vehicles' },
  { value: 'suv', label: 'SUV', icon: CarFront, group: 'Vehicles' },
  { value: '4x4', label: '4x4', icon: Mountain, group: 'Vehicles' },
  { value: 'hatchback', label: 'Hatchback', icon: Car, group: 'Vehicles' },
  { value: 'pickup', label: 'Pickup', icon: Truck, group: 'Vehicles' },
  { value: 'van', label: 'Van', icon: Caravan, group: 'Vehicles' },
  { value: 'minibus', label: 'Minibus', icon: Bus, group: 'Vehicles' },
  { value: 'luxury', label: 'Luxury', icon: Gem, group: 'Vehicles' },
  // Cultivating (agricultural machinery)
  { value: 'tractor', label: 'Tractor', icon: Tractor, group: 'Cultivating' },
  { value: 'harvester', label: 'Harvester', icon: Wheat, group: 'Cultivating' },
  { value: 'tiller', label: 'Tiller', icon: Sprout, group: 'Cultivating' },
  // Building (construction machinery)
  { value: 'excavator', label: 'Excavator', icon: Construction, group: 'Building' },
  { value: 'bulldozer', label: 'Bulldozer', icon: Construction, group: 'Building' },
  { value: 'loader', label: 'Loader', icon: Truck, group: 'Building' },
  { value: 'crane', label: 'Crane', icon: Construction, group: 'Building' },
  { value: 'forklift', label: 'Forklift', icon: Forklift, group: 'Building' },
];

/** Category groups in display order — used to render grouped category lists. */
export const CATEGORY_GROUPS: CategoryGroup[] = ['Vehicles', 'Cultivating', 'Building'];

/** Which group a category belongs to. Unknown values are treated as vehicles. */
export function groupFor(value: CarCategory): CategoryGroup {
  return CAR_CATEGORIES.find((c) => c.value === value)?.group ?? 'Vehicles';
}

/**
 * Machinery rents through the same flow as a car, but it isn't *described* like one:
 * a tractor has a cab rather than seats, and runs on power rather than fuel. Callers
 * use this to relabel the shared listing form and detail copy.
 */
export function isMachine(value: CarCategory): boolean {
  return groupFor(value) !== 'Vehicles';
}
