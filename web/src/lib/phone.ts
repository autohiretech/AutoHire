import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Phone numbers, judged by the rules of the country the account is in.
 *
 * This used to be two regexes and an assumption: any number starting with a
 * trunk zero was Rwandan, and anything else only had to be `+` followed by
 * 8–15 digits. That accepts `+250 12345` — a number no Rwandan network will
 * ever route — and turns an Emirati host's own `055…` into a +250 number, so
 * the SMS code went to a Rwandan handset that isn't theirs.
 *
 * The rules themselves are Google's libphonenumber metadata rather than a
 * table written here: it knows each country's valid lengths and ranges, and
 * it is the same data that keeps working when a numbering plan changes. It
 * also supplies the calling code, so there is no second list of dial codes to
 * drift out of step with it.
 *
 * `country` is the ISO 3166-1 alpha-2 code of the *account*, which is what a
 * locally-typed number is interpreted against. A number typed in full
 * international form is taken as it stands whatever the account's country —
 * a Kenyan renting in Rwanda keeps their Kenyan number.
 */

/** Narrow an arbitrary string to a country libphonenumber actually knows. */
function knownCountry(country: string | null | undefined): CountryCode | undefined {
  if (!country) return undefined;
  const upper = country.toUpperCase();
  return isSupportedCountry(upper) ? (upper as CountryCode) : undefined;
}

/**
 * The country's calling code, as `+250`. Null when the country is unknown to
 * the metadata, and then the phone field asks for a full international number
 * instead of showing a prefix it cannot stand behind.
 */
export function dialCodeFor(country: string | null | undefined): string | null {
  const code = knownCountry(country);
  return code ? `+${getCountryCallingCode(code)}` : null;
}

/**
 * Normalise to E.164 (+CCXXXXXXXXX), or null when the number is not a valid
 * one for that country. Null is the answer for "invalid", not just for
 * "unparseable" — a wrong-length number is a wrong number.
 */
export function normalizePhone(raw: string, country?: string | null): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, knownCountry(country));
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/**
 * The same check, phrased for the person who typed it: null when the number is
 * fine, otherwise a sentence naming the country whose rules it failed. The
 * caller supplies the country's display name, because the picker already has
 * it and this module should not carry a second list of country names.
 */
export function phoneProblem(
  raw: string,
  country: string | null | undefined,
  countryName?: string,
): string | null {
  if (!raw.trim()) return 'Please enter your phone number.';
  if (normalizePhone(raw, country)) return null;
  const known = knownCountry(country);
  if (!known) return 'Enter your number in full, with its country code — e.g. +250 788 123 456.';
  // "a number for Rwanda", not "a Rwanda number" — the picker gives a country
  // NAME, and turning names into adjectives (Rwanda → Rwandan, China →
  // Chinese, UAE → ?) is a list this module has no business carrying.
  const where = countryName ? `for ${countryName}` : 'for your country';
  return `That doesn't look like a valid number ${where}. Check the digits, or type it in full with its country code.`;
}

/**
 * The country a fully-typed international number belongs to, or null.
 *
 * Only answers for input that carries its own `+` code — that is the case
 * where the account's country and the number's country can disagree, and the
 * field should show the number's, not the account's. Someone selecting
 * Burundi and typing `+250 799 494 538` has typed a valid Rwandan number, and
 * a chip reading `+257` beside it is the interface lying about what will be
 * saved.
 */
export function countryOfTyped(raw: string): { country: string; dialCode: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(trimmed);
  if (!parsed?.country) return null;
  return { country: parsed.country, dialCode: `+${parsed.countryCallingCode}` };
}
