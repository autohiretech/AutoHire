import { Bus, Car, CarFront, Caravan, Gem, Mountain, Truck, type LucideIcon } from 'lucide-react';
import type { CarCategory } from '@autohire/shared';

/**
 * Browseable car categories with a label + icon, shared by the home search
 * dropdown ([MegaSearch]) and the category tile rail ([CategoryRail]).
 */
export const CAR_CATEGORIES: { value: CarCategory; label: string; icon: LucideIcon }[] = [
  { value: 'sedan', label: 'Sedan', icon: Car },
  { value: 'suv', label: 'SUV', icon: CarFront },
  { value: '4x4', label: '4x4', icon: Mountain },
  { value: 'hatchback', label: 'Hatchback', icon: Car },
  { value: 'pickup', label: 'Pickup', icon: Truck },
  { value: 'van', label: 'Van', icon: Caravan },
  { value: 'minibus', label: 'Minibus', icon: Bus },
  { value: 'luxury', label: 'Luxury', icon: Gem },
];
