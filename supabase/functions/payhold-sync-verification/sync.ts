// AutoHire — payhold-sync-verification: the relay itself, kept apart from the
// HTTP shell in `index.ts` so it can be exercised over a stubbed `fetch`.
//
// One rule: PayHold is told what `profiles.verification` SAYS, never what a
// button claimed. `verified: true` if the stored status is `verified`, `false`
// for anything else — `pending`, `rejected`, `unverified` are all "not
// verified" to a payout platform. That makes this idempotent and safe to call
// again after a failure, and it means a stale or hostile browser cannot tell
// PayHold something the database does not.
//
// Who decided travels with it: `verified_by = autohire-admin:<admin profile
// id>`, built by `index.ts` from the session — never from the request. PayHold
// requires it, and it is the only verifier PayHold will now accept for our
// sellers: its own dashboard and auto-verify no longer verify them
// (`platform_owns_verification`).
//
// Two consequences, both correct:
//
//   • Approving ONE document (`DocumentRow` → `reviewVerificationDocument`)
//     only moves `profiles.verification` when every required document is
//     approved — `sync_profile_verification()` (migration-033) recomputes it.
//     After a partial approval the stored status is still `pending`, so this
//     relays `false`. A host is not verified in PayHold until AutoHire says so.
//
//   • That trigger bails out while `verification_override` is true
//     (migration-033), so after an admin override, document decisions no
//     longer move the profile. A sync after one reads the overridden value.
//     The override IS the admin's decision; relaying it is right.

import {
  findSellerByExternalUserId,
  isSellerGone,
  isVerificationRelayRefused,
  setSellerVerified,
} from '../_shared/payhold.ts';

/**
 * What PayHold now says, or why it says nothing new.
 *
 *   verified         PayHold's seller is now verified (relayed `true`).
 *   unverified       PayHold's seller is now not verified (relayed `false`).
 *   not_registered   This host has no PayHold seller; nothing was sent. Not
 *                    an error — most people in the review queue are renters.
 *   not_trusted_yet  PayHold refused the API key because verification relay is
 *                    off (422 `verification_relay_off`). Designed behaviour,
 *                    never retried from here.
 *   failed           Anything else — PayHold unreachable, a 5xx, a refusal
 *                    with a different meaning. `error` carries the words.
 *
 * In every case the AutoHire-side decision already stands; nothing here rolls
 * it back or reports it as having failed.
 */
export type PayholdVerificationOutcome =
  | 'verified'
  | 'unverified'
  | 'not_registered'
  | 'not_trusted_yet'
  | 'failed';

export interface StoredProfile {
  id: string;
  verification: string;
  payhold_seller_id: string | null;
}

export interface SyncResult {
  profileId: string;
  /** What `profiles.verification` holds — the one fact this relays. */
  verification: string;
  /** The boolean that was (or would have been) sent: `verification === 'verified'`. */
  verified: boolean;
  payhold: PayholdVerificationOutcome;
  sellerId: string | null;
  /** The link was stale and a seller under this host's handle was re-linked first. */
  relinked?: boolean;
  /** The link was stale and no seller exists under this handle; the column was cleared. */
  staleLinkCleared?: boolean;
  error?: string;
}

export interface SyncDeps {
  /**
   * Write `profiles.payhold_seller_id` — `null` to clear a stale link, an id to
   * re-link. The same repair `payhold-ensure-seller` makes; `index.ts` wires
   * this to the service-role client.
   */
  writeSellerLink: (profileId: string, sellerId: string | null) => Promise<void>;
}

/**
 * `verifiedBy` is the caller's — `autohire-admin:<profile id>`, from the session
 * in `index.ts`. Nothing the client sends can name a verifier.
 */
export async function relayVerification(
  profile: StoredProfile,
  verifiedBy: string,
  deps: SyncDeps,
): Promise<SyncResult> {
  const verified = profile.verification === 'verified';
  const base = { profileId: profile.id, verification: profile.verification, verified };

  const sellerId = profile.payhold_seller_id;
  if (!sellerId) {
    return { ...base, payhold: 'not_registered', sellerId: null };
  }

  const attempt = async (id: string): Promise<SyncResult> => {
    try {
      await setSellerVerified(id, verified, verifiedBy);
      return { ...base, payhold: verified ? 'verified' : 'unverified', sellerId: id };
    } catch (e) {
      // Relay is off. Not retried — nothing on our side changes the answer;
      // a person in PayHold's Settings does.
      if (isVerificationRelayRefused(e)) {
        return { ...base, payhold: 'not_trusted_yet', sellerId: id };
      }
      throw e;
    }
  };

  try {
    return await attempt(sellerId);
  } catch (e) {
    // The link names a seller PayHold no longer has — a tenant sandbox reset,
    // a profile carried between environments. Same repair as the sibling
    // functions: re-link by our own handle if a seller still lives under it,
    // otherwise clear the column so the host reads as unregistered instead of
    // failing on every retry forever. Only THIS 404 repairs (`isSellerGone`).
    if (isSellerGone(e)) {
      console.warn(
        `[payhold-sync-verification] payhold_seller_id ${sellerId} is unknown to PayHold — ` +
          'clearing the stale link and re-linking by external_user_id.',
      );
      const existing = await findSellerByExternalUserId(profile.id).catch(() => null);
      if (!existing) {
        await deps.writeSellerLink(profile.id, null);
        return { ...base, payhold: 'not_registered', sellerId: null, staleLinkCleared: true };
      }
      await deps.writeSellerLink(profile.id, existing.id);
      try {
        return { ...(await attempt(existing.id)), relinked: true };
      } catch (again) {
        return failed(base, existing.id, again, { relinked: true });
      }
    }
    return failed(base, sellerId, e);
  }
}

function failed(
  base: Pick<SyncResult, 'profileId' | 'verification' | 'verified'>,
  sellerId: string,
  e: unknown,
  extra: Partial<SyncResult> = {},
): SyncResult {
  const error = e instanceof Error ? e.message : String(e);
  console.error('[payhold-sync-verification] PayHold refused or was unreachable', {
    sellerId,
    error,
  });
  return { ...base, ...extra, payhold: 'failed', sellerId, error };
}
