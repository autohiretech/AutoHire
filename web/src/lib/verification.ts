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

/** Which set of documents applies to the signed-in account. */
export type VerificationRole = 'renter' | 'personalHost' | 'businessHost';

const DOC: Record<VerificationDocType, DocConfig> = {
  drivers_license: {
    type: 'drivers_license',
    label: "Driver's license",
    hint: 'Front of a valid Rwandan or international driving permit.',
  },
  national_id: {
    type: 'national_id',
    label: 'National ID / passport',
    hint: 'Government-issued photo ID to confirm your identity.',
  },
  vehicle_registration: {
    type: 'vehicle_registration',
    label: 'Vehicle registration',
    hint: 'Yellow card / registration certificate for the vehicle you list.',
  },
  insurance_certificate: {
    type: 'insurance_certificate',
    label: 'Proof of insurance',
    hint: 'Current insurance certificate covering the vehicle.',
  },
  business_registration: {
    type: 'business_registration',
    label: 'Business registration',
    hint: 'RDB certificate or trading licence for your company.',
  },
};

/**
 * Documents required of each role, in display order. A renter proves identity;
 * a personal host adds their vehicle's papers; a business host verifies the
 * company and its fleet.
 */
export const VERIFICATION_DOCS: Record<VerificationRole, DocConfig[]> = {
  renter: [DOC.drivers_license, DOC.national_id],
  personalHost: [
    DOC.drivers_license,
    DOC.national_id,
    DOC.vehicle_registration,
    DOC.insurance_certificate,
  ],
  businessHost: [
    DOC.business_registration,
    DOC.national_id,
    DOC.vehicle_registration,
    DOC.insurance_certificate,
  ],
};

export const VERIFICATION_ROLE_META: Record<VerificationRole, { label: string; blurb: string }> = {
  renter: {
    label: 'Renter',
    blurb: 'Confirm your identity so you can book and drive cars.',
  },
  personalHost: {
    label: 'Personal host',
    blurb: 'Confirm your identity and your vehicle so you can rent it out.',
  },
  businessHost: {
    label: 'Business host',
    blurb: 'Verify your company and fleet so you can list vehicles.',
  },
};

/** Pick the verification role from the account (role + owner type). */
export function verificationRoleFor(profile?: {
  role?: string;
  ownerType?: string | null;
}): VerificationRole {
  if (profile?.ownerType === 'business') return 'businessHost';
  if (profile?.role === 'owner') return 'personalHost';
  return 'renter';
}

/** Roll a set of document statuses up into one overall status. */
export function overallStatus(statuses: VerificationStatus[]): VerificationStatus {
  if (statuses.length === 0 || statuses.includes('unverified')) return 'unverified';
  if (statuses.includes('rejected')) return 'rejected';
  if (statuses.includes('pending')) return 'pending';
  return 'verified';
}
