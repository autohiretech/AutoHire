/**
 * Normalise a phone number to E.164 (+CCXXXXXXXXX), or null if invalid.
 * Accepts international numbers (tourists) as well as the local Rwandan format:
 *   0788 123 456    -> +250788123456
 *   +1 202 555 0142 -> +12025550142
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '');
  // Local Rwandan format (leading 0, 10 digits) -> assume +250.
  if (/^0\d{9}$/.test(cleaned)) return `+250${cleaned.slice(1)}`;
  // Any E.164 international number: + then 8–15 digits.
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  return null;
}
