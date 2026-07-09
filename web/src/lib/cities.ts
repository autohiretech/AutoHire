/**
 * Cities we hold inventory in, per market.
 *
 * Mirrors the demo seed data (migrations 024 cars / 026 machines / 027 US cars) and is
 * the single source the browse filters, the search chips and the listing form read
 * from — they each used to carry their own hardcoded Rwanda-only copy, so switching
 * the header country still showed Kigali, Musanze, Rubavu…
 */
export const COUNTRY_CITIES: Record<string, string[]> = {
  RW: ['Kigali', 'Musanze', 'Rubavu', 'Huye', 'Rusizi'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
  CN: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu'],
  US: [
    'New York',
    'Los Angeles',
    'San Francisco',
    'Chicago',
    'Austin',
    'Miami',
    'Seattle',
    'Denver',
    'Boston',
    'Atlanta',
  ],
};

/** Cities for one market, or an empty list for a market we don't serve yet. */
export function citiesFor(countryCode: string): string[] {
  return COUNTRY_CITIES[countryCode] ?? [];
}

/** Every city across every market — the demo AI parser matches queries against all of them. */
export const ALL_CITIES: string[] = Object.values(COUNTRY_CITIES).flat();

/**
 * The market a city belongs to, if any. A city name is unique across our markets, so
 * naming one in a search ("cheapest cars in Dubai") can retarget the query to that
 * market instead of returning nothing because the header is still set to Rwanda.
 */
export function countryOfCity(city: string | undefined): string | undefined {
  if (!city) return undefined;
  return Object.keys(COUNTRY_CITIES).find((code) => COUNTRY_CITIES[code].includes(city));
}
