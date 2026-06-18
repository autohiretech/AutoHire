import type { VerificationDocType, VerificationStatus } from '@autohire/shared';

type BadgeTone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const VERIFICATION_STATUS_META: Record<
  VerificationStatus,
  { label: string; tone: BadgeTone }
> = {
  unverified: { label: 'Not uploaded', tone: 'neutral' },
  pending: { label: 'Pending review', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export interface DocConfig {
  type: VerificationDocType;
  label: string;
  hint: string;
}

/** Documents required of each role, in display order. */
export const VERIFICATION_DOCS: Record<'renter' | 'host', DocConfig[]> = {
  renter: [
    {
      type: 'drivers_license',
      label: "Driver's license",
      hint: 'Front of a valid Rwandan or international driving permit.',
    },
    {
      type: 'national_id',
      label: 'National ID / passport',
      hint: 'Government-issued photo ID to confirm your identity.',
    },
  ],
  host: [
    {
      type: 'vehicle_registration',
      label: 'Vehicle registration',
      hint: 'Yellow card / registration certificate for the vehicle.',
    },
    {
      type: 'insurance_certificate',
      label: 'Proof of insurance',
      hint: 'Current insurance certificate covering the vehicle.',
    },
  ],
};

/** Roll a set of document statuses up into one overall status. */
export function overallStatus(statuses: VerificationStatus[]): VerificationStatus {
  if (statuses.length === 0 || statuses.includes('unverified')) return 'unverified';
  if (statuses.includes('rejected')) return 'rejected';
  if (statuses.includes('pending')) return 'pending';
  return 'verified';
}
