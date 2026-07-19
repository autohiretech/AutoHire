import type { CarCategory, FuelType } from '@autohire/shared';

/**
 * Curated list of common car models for the listing picker. Each entry knows
 * its make, typical fuel and body category, so choosing a model auto-fills
 * those fields. Electric models are listed first and badged in the UI to steer
 * hosts toward the platform's electric goal. Hosts can still type a custom
 * make/model if theirs isn't here.
 */
export interface CarModel {
  make: string;
  model: string;
  fuel: FuelType;
  category: CarCategory;
}

export const CAR_MODELS: CarModel[] = [
  // --- Electric ------------------------------------------------------------
  { make: 'Tesla', model: 'Model 3', fuel: 'electric', category: 'sedan' },
  { make: 'Tesla', model: 'Model Y', fuel: 'electric', category: 'suv' },
  { make: 'Tesla', model: 'Model S', fuel: 'electric', category: 'luxury' },
  { make: 'Tesla', model: 'Model X', fuel: 'electric', category: 'suv' },
  { make: 'Nissan', model: 'Leaf', fuel: 'electric', category: 'hatchback' },
  { make: 'BYD', model: 'Atto 3', fuel: 'electric', category: 'suv' },
  { make: 'BYD', model: 'Dolphin', fuel: 'electric', category: 'hatchback' },
  { make: 'BYD', model: 'Seal', fuel: 'electric', category: 'sedan' },
  { make: 'BYD', model: 'Han', fuel: 'electric', category: 'luxury' },
  { make: 'Hyundai', model: 'Kona Electric', fuel: 'electric', category: 'suv' },
  { make: 'Hyundai', model: 'Ioniq 5', fuel: 'electric', category: 'suv' },
  { make: 'Hyundai', model: 'Ioniq 6', fuel: 'electric', category: 'sedan' },
  { make: 'Kia', model: 'EV6', fuel: 'electric', category: 'suv' },
  { make: 'Kia', model: 'Niro EV', fuel: 'electric', category: 'suv' },
  { make: 'Volkswagen', model: 'ID.4', fuel: 'electric', category: 'suv' },
  { make: 'Volkswagen', model: 'ID.3', fuel: 'electric', category: 'hatchback' },
  { make: 'Chevrolet', model: 'Bolt EV', fuel: 'electric', category: 'hatchback' },
  { make: 'Renault', model: 'Zoe', fuel: 'electric', category: 'hatchback' },
  { make: 'Peugeot', model: 'e-208', fuel: 'electric', category: 'hatchback' },
  { make: 'MG', model: 'ZS EV', fuel: 'electric', category: 'suv' },
  { make: 'MG', model: 'MG4', fuel: 'electric', category: 'hatchback' },
  { make: 'Polestar', model: '2', fuel: 'electric', category: 'sedan' },
  { make: 'Ford', model: 'Mustang Mach-E', fuel: 'electric', category: 'suv' },
  { make: 'Audi', model: 'e-tron', fuel: 'electric', category: 'suv' },
  { make: 'Audi', model: 'Q4 e-tron', fuel: 'electric', category: 'suv' },
  { make: 'Mercedes-Benz', model: 'EQC', fuel: 'electric', category: 'suv' },
  { make: 'Mercedes-Benz', model: 'EQS', fuel: 'electric', category: 'luxury' },
  { make: 'BMW', model: 'i4', fuel: 'electric', category: 'sedan' },
  { make: 'BMW', model: 'iX', fuel: 'electric', category: 'suv' },
  { make: 'Volvo', model: 'XC40 Recharge', fuel: 'electric', category: 'suv' },
  { make: 'Toyota', model: 'bZ4X', fuel: 'electric', category: 'suv' },
  { make: 'Jaguar', model: 'I-PACE', fuel: 'electric', category: 'suv' },
  { make: 'Mahindra', model: 'XUV400 EV', fuel: 'electric', category: 'suv' },
  { make: 'Tata', model: 'Nexon EV', fuel: 'electric', category: 'suv' },

  // --- Hybrid --------------------------------------------------------------
  { make: 'Toyota', model: 'Prius', fuel: 'hybrid', category: 'hatchback' },
  { make: 'Toyota', model: 'RAV4 Hybrid', fuel: 'hybrid', category: 'suv' },
  { make: 'Toyota', model: 'Corolla Hybrid', fuel: 'hybrid', category: 'sedan' },
  { make: 'Honda', model: 'CR-V Hybrid', fuel: 'hybrid', category: 'suv' },
  { make: 'Lexus', model: 'RX 450h', fuel: 'hybrid', category: 'luxury' },

  // --- Petrol --------------------------------------------------------------
  { make: 'Toyota', model: 'Corolla', fuel: 'petrol', category: 'sedan' },
  { make: 'Toyota', model: 'RAV4', fuel: 'petrol', category: 'suv' },
  { make: 'Toyota', model: 'Vitz', fuel: 'petrol', category: 'hatchback' },
  { make: 'Honda', model: 'Civic', fuel: 'petrol', category: 'sedan' },
  { make: 'Honda', model: 'Fit', fuel: 'petrol', category: 'hatchback' },
  { make: 'Nissan', model: 'X-Trail', fuel: 'petrol', category: 'suv' },
  { make: 'Suzuki', model: 'Swift', fuel: 'petrol', category: 'hatchback' },
  { make: 'Mazda', model: 'Demio', fuel: 'petrol', category: 'hatchback' },
  { make: 'Volkswagen', model: 'Golf', fuel: 'petrol', category: 'hatchback' },

  // --- Diesel --------------------------------------------------------------
  { make: 'Toyota', model: 'Land Cruiser', fuel: 'diesel', category: '4x4' },
  { make: 'Toyota', model: 'Land Cruiser Prado', fuel: 'diesel', category: '4x4' },
  { make: 'Toyota', model: 'Hilux', fuel: 'diesel', category: 'pickup' },
  { make: 'Toyota', model: 'Hiace', fuel: 'diesel', category: 'van' },
  { make: 'Nissan', model: 'Navara', fuel: 'diesel', category: 'pickup' },
  { make: 'Isuzu', model: 'D-Max', fuel: 'diesel', category: 'pickup' },
  { make: 'Ford', model: 'Ranger', fuel: 'diesel', category: 'pickup' },
  { make: 'Mitsubishi', model: 'Pajero', fuel: 'diesel', category: '4x4' },
];

/** Search the model list by make or model (electric results first). */
export function searchCarModels(query: string, limit = 8): CarModel[] {
  const q = query.trim().toLowerCase();
  const scored = CAR_MODELS.filter(
    (m) =>
      !q ||
      m.model.toLowerCase().includes(q) ||
      m.make.toLowerCase().includes(q) ||
      `${m.make} ${m.model}`.toLowerCase().includes(q),
  );
  // Electric first, then alphabetical by make/model.
  scored.sort((a, b) => {
    const ae = a.fuel === 'electric' ? 0 : 1;
    const be = b.fuel === 'electric' ? 0 : 1;
    if (ae !== be) return ae - be;
    return `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`);
  });
  return scored.slice(0, limit);
}
