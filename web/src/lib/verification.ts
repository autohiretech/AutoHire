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
    // Optional, and said plainly: a renter can book without ever opening this
    // page, and a declined document costs them nothing on the renting path
    // (see BookingPage). Promising "so you can book" was the old gate talking.
    label: 'Renter',
    blurb: 'Optional — verified renters stand out to hosts reviewing a booking request.',
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

/**
 * The documents a role needs that the previous role did not.
 *
 * Becoming a host does not invalidate the licence and ID a renter already
 * uploaded — it adds the vehicle's papers on top (and for a company, swaps the
 * licence for the business registration). This is what the switch tells them
 * they now owe, rather than making them compare two lists themselves.
 */
export function docsAddedBetween(from: VerificationRole, to: VerificationRole): DocConfig[] {
  const had = new Set(VERIFICATION_DOCS[from].map((d) => d.type));
  return VERIFICATION_DOCS[to].filter((d) => !had.has(d.type));
}

/**
 * The verification status to show an account holder **for the role they are
 * now** — which is not always the status stored on the account.
 *
 * Two facts have to be combined, and neither can simply win:
 *
 * - The account's own `verification` column is a decision, usually a
 *   reviewer's. It has to be able to say "no" over documents that all say yes,
 *   which is why this page stopped doing its own arithmetic in the first place.
 * - The document set is not fixed: it is chosen by the role. A renter who
 *   uploaded a licence and an ID and was verified becomes a *host* owing two
 *   more documents nobody has ever looked at. Reporting "Verified" then is the
 *   account answering a question it was never asked.
 *
 * So the worse of the two wins, in `overallStatus`'s own precedence — an
 * approval cannot outrank a document that does not exist yet, and a refusal
 * cannot be undone by uploading more. The exception is an explicit
 * account-level override (`verificationOverride`), where a reviewer has
 * deliberately decided about the account rather than about its documents; that
 * decision stands as it is.
 */
export function effectiveVerificationStatus({
  accountStatus,
  decidedByAdmin,
  docStatuses,
}: {
  accountStatus?: VerificationStatus | null;
  decidedByAdmin?: boolean;
  docStatuses: VerificationStatus[];
}): VerificationStatus {
  const fromDocuments = overallStatus(docStatuses);
  if (!accountStatus) return fromDocuments;
  if (decidedByAdmin) return accountStatus;
  return overallStatus([accountStatus, fromDocuments]);
}
