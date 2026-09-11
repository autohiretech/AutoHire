import type {
  DisputeStatus,
  ModerationStatus,
  OwnerType,
  UserRole,
  VerificationDocType,
  VerificationStatus,
} from '@autohire/shared';
import { client } from '@/lib/client';
import { toast } from '@/components/ui';

type BadgeTone = 'brand' | 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const MODERATION_STATUS_META: Record<ModerationStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  removed: { label: 'Removed', tone: 'danger' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export const DISPUTE_STATUS_META: Record<DisputeStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  under_review: { label: 'Under review', tone: 'accent' },
  resolved_renter: { label: 'Resolved — renter', tone: 'success' },
  resolved_host: { label: 'Resolved — host', tone: 'success' },
  resolved_split: { label: 'Resolved — split', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export const FLAG_REASON_LABEL: Record<string, string> = {
  inappropriate: 'Inappropriate',
  spam: 'Spam',
  fraud: 'Fraud',
  safety: 'Safety',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

export const DOC_TYPE_LABEL: Record<VerificationDocType, string> = {
  drivers_license: "Driver's license",
  national_id: 'National ID or passport',
  vehicle_registration: 'Vehicle registration',
  insurance_certificate: 'Proof of insurance',
  business_registration: 'Business registration',
};

/** An overall or per-document status, in words an admin reads at a glance. */
export const VERIFICATION_META: Record<VerificationStatus, { label: string; tone: BadgeTone }> = {
  verified: { label: 'Verified', tone: 'success' },
  pending: { label: 'In review', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
  unverified: { label: 'Not verified', tone: 'neutral' },
};

/**
 * The documents a person must have approved before they count as verified.
 *
 * Mirrors `compute_profile_verification` (migration 031), which is what
 * actually decides `profiles.verification` whenever a document changes. The
 * review screen lists requirements from this so an admin sees exactly what the
 * database is waiting for — change both together.
 */
export function requiredDocTypes(role: UserRole, ownerType?: OwnerType | null): VerificationDocType[] {
  if (ownerType === 'business') {
    return ['business_registration', 'national_id', 'vehicle_registration', 'insurance_certificate'];
  }
  if (role === 'owner') {
    return ['drivers_license', 'national_id', 'vehicle_registration', 'insurance_certificate'];
  }
  return ['drivers_license', 'national_id'];
}

export function accountKindLabel(role: UserRole, ownerType?: OwnerType | null): string {
  if (role === 'admin') return 'Admin';
  if (ownerType === 'business') return 'Business host';
  if (role === 'owner') return 'Host';
  return 'Renter';
}

/** One-tap reasons for rejecting a document. The applicant reads the note, so
 * each says what to fix rather than just that something is wrong. */
export const REJECTION_REASONS = [
  'The photo is blurry or too dark to read.',
  'Part of the document is cut off.',
  'The document has expired.',
  "The name doesn't match the name on the account.",
  'This is the wrong document for this step.',
  "The document looks edited or isn't genuine.",
];

/**
 * Tell PayHold what AutoHire now says about this person, and say what happened.
 *
 * Runs after the AutoHire decision has already been saved, so nothing here can
 * undo it or make it look failed. The Edge Function reads the stored status
 * itself — this only passes the profile id.
 *
 * Verifying someone is not the same as making them payable: PayHold still
 * checks each payout account separately, so the success message says so
 * rather than implying money will now move.
 */
export async function relayVerificationToPayhold(
  profileId: string,
  opts: { quietUnlessVerified?: boolean } = {},
) {
  try {
    const r = await client.syncHostVerificationToPayhold(profileId);
    switch (r.payhold) {
      case 'verified':
        toast.success(
          'Verified in PayHold too. Their payout account still needs its own check before money can be sent.',
        );
        break;
      case 'unverified':
        // A single document approval usually leaves the person pending, which
        // relays "not verified" — true, but not news, so it stays quiet.
        if (!opts.quietUnlessVerified) toast.info('PayHold now shows this person as not verified.');
        break;
      case 'not_trusted_yet':
        toast.info(
          "Saved in AutoHire. PayHold hasn't been told to accept AutoHire's checks yet — in PayHold, open Settings and turn on “I review each seller myself and tell PayHold the result”.",
        );
        break;
      case 'failed':
        toast.error(
          `Saved in AutoHire, but PayHold couldn't be updated${r.error ? `: ${r.error}` : ''}. Pressing the button again is safe.`,
        );
        break;
      // 'not_registered': most people in this queue are renters, with no PayHold
      // seller to update. Nothing to say.
    }
  } catch (e) {
    toast.error(
      `Saved in AutoHire, but PayHold couldn't be reached: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
