// AutoHire — payhold-verify-destination: the logic, kept apart from the HTTP
// shell in `index.ts` so it runs over injected deps and a stubbed `fetch`.
//
// **A host's payout account is verified in AutoHire's admin and nowhere else.**
// PayHold's tenant setting `platform_owns_verification` (on by default) makes
// its own dashboard refuse a person there with 409
// `verification_owned_by_platform`, and its auto-verify no longer verifies, so
// this relay is the only way a destination becomes — or stops being — verified.
//
// Three rules hold it together:
//
//   1. The account is read here, server-side, every time. The client names a
//      profile and a direction and nothing else; a destination id in the body
//      is ignored, so a stale or hostile browser cannot verify an account the
//      admin was not shown. A seller has one live destination, and that is the
//      one verified.
//   2. The verifier is the session's admin — `autohire-admin:<profile id>` —
//      never a field of the request. The name shown back (`verifierName`) is
//      looked up from `profiles.full_name` here, so no name or email is ever
//      sent to PayHold.
//   3. Verifying does not end §5.1's security hold, and nothing an API key can
//      send does: the hold expires on its own timer. `securityHoldUntil` is
//      returned so the admin can see it still running.
//
// PayHold's answer, as `outcome`:
//   verified / unverified  PayHold took it; `account` is what PayHold now holds.
//   not_trusted_yet        relay is off (422 `destination_relay_off`) — or, until
//                          the new PayHold is deployed, its old refusal of an
//                          API key on this route. Never retried from here.
//   changed                the account was replaced while the admin looked
//                          (409 `destination_archived`); `account` is the new,
//                          unverified one — the admin checks it again.
//   not_registered         no PayHold seller for this host; nothing was sent.
//   no_destination         a seller with no payout account; nothing was sent.

import {
  PayHoldError,
  autohireAdminActor,
  autohireAdminProfileId,
  findSellerByExternalUserId,
  isDestinationArchived,
  isDestinationRelayOff,
  isSellerGone,
  payholdConfigured,
  sellerCapabilities,
  sellerDestinations,
  setDestinationVerified,
  type SellerDestination,
} from '../_shared/payhold.ts';
import { reconcilePayoutStatus } from '../_shared/payout-status.ts';

/** Mirrors `HostPayoutAccount` in `packages/shared`. */
export interface HostPayoutAccount {
  destinationId: string;
  sellerId: string;
  maskedDestination: string;
  payoutProvider: string;
  method: 'momo' | 'bank' | 'card' | 'paypal' | 'stripe' | string;
  country: string;
  payoutCurrency: string;
  label: string | null;
  verifiedAt: string | null;
  securityHoldUntil: string | null;
  reportedVerifier: string | null;
  verifierName: string | null;
}

export type PayoutAccountVerifyOutcome =
  | 'verified'
  | 'unverified'
  | 'not_trusted_yet'
  | 'not_registered'
  | 'no_destination'
  | 'changed';

export type NoAccountReason = 'not_registered' | 'no_destination';

export interface PayoutAccountRead {
  account: HostPayoutAccount | null;
  reason?: NoAccountReason;
}

export interface PayoutAccountVerifyResult {
  outcome: PayoutAccountVerifyOutcome;
  account: HostPayoutAccount | null;
}

export class PayoutAccountError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'PayoutAccountError';
  }
}

export interface HostProfile {
  id: string;
  payhold_seller_id: string | null;
  payout_status: string | null;
}

export interface AccountDeps {
  readProfile: (profileId: string) => Promise<HostProfile | null>;
  /** `profiles.full_name`, or null. */
  profileName: (profileId: string) => Promise<string | null>;
  /** Write `profiles.payhold_seller_id` — null clears a stale link. */
  writeSellerLink: (profileId: string, sellerId: string | null) => Promise<void>;
  /** Write `profiles.payout_status`. Throws on failure. */
  writePayoutStatus: (profileId: string, status: string) => Promise<void>;
}

export interface HandlerDeps extends AccountDeps {
  /** The auth user behind a bearer token, or null. */
  userIdForToken: (token: string) => Promise<string | null>;
  /** `profiles.role` for a user, or null. */
  roleOf: (userId: string) => Promise<string | null>;
}

const METHOD_BY_RAIL: Record<string, string> = {
  flutterwave_momo: 'momo',
  flutterwave_bank: 'bank',
  paypal: 'paypal',
  stripe_connect: 'stripe',
};

/** The payout method a rail carries, in AutoHire's words. An unknown rail is named as-is. */
export function methodForRail(rail: string | null | undefined): string {
  if (!rail) return 'unknown';
  return METHOD_BY_RAIL[rail] ?? rail;
}

/** The destination money goes to: a live row — the primary if one is marked, else the first. */
export function liveDestination(
  destinations: SellerDestination[] | null | undefined,
): SellerDestination | null {
  const live = (Array.isArray(destinations) ? destinations : []).filter(
    (d) => d && typeof d.id === 'string' && d.id && !d.archived_at,
  );
  return live.find((d) => d.is_primary) ?? live[0] ?? null;
}

async function toAccount(
  sellerId: string,
  d: SellerDestination,
  deps: AccountDeps,
): Promise<HostPayoutAccount> {
  const reportedVerifier = typeof d.reported_verifier === 'string' && d.reported_verifier.trim()
    ? d.reported_verifier.trim()
    : null;
  const adminId = autohireAdminProfileId(reportedVerifier);
  const name = adminId ? await deps.profileName(adminId).catch(() => null) : null;
  return {
    destinationId: d.id,
    sellerId,
    maskedDestination: d.masked_destination,
    payoutProvider: d.payout_provider,
    method: methodForRail(d.payout_provider),
    country: d.country,
    payoutCurrency: d.payout_currency,
    label: d.label ?? null,
    verifiedAt: d.verified_at ?? null,
    securityHoldUntil: d.security_hold_until ?? null,
    reportedVerifier,
    verifierName: name?.trim() || null,
  };
}

interface Live {
  sellerId: string | null;
  destination: SellerDestination | null;
}

function reasonFor(live: Live): NoAccountReason | null {
  if (!live.sellerId) return 'not_registered';
  if (!live.destination) return 'no_destination';
  return null;
}

/**
 * The seller's live destination, read from PayHold now.
 *
 * A link naming a seller PayHold no longer has (a sandbox reset) is repaired
 * the way `payhold-sync-verification` repairs it: re-linked to a seller still
 * under this host's handle, else cleared so the host reads as unregistered.
 * Only that 404 repairs (`isSellerGone`).
 */
async function readLive(
  profileId: string,
  sellerId: string | null,
  deps: AccountDeps,
): Promise<Live> {
  if (!sellerId) return { sellerId: null, destination: null };
  try {
    const { destinations } = await sellerDestinations(sellerId);
    return { sellerId, destination: liveDestination(destinations) };
  } catch (e) {
    if (!isSellerGone(e)) throw e;
    console.warn(
      `[payhold-verify-destination] payhold_seller_id ${sellerId} is unknown to PayHold — ` +
        're-linking by external_user_id.',
    );
    const existing = await findSellerByExternalUserId(profileId).catch(() => null);
    await deps.writeSellerLink(profileId, existing?.id ?? null);
    if (!existing) return { sellerId: null, destination: null };
    const { destinations } = await sellerDestinations(existing.id);
    return { sellerId: existing.id, destination: liveDestination(destinations) };
  }
}

async function loadProfile(profileId: string, deps: AccountDeps): Promise<HostProfile> {
  const id = profileId.trim();
  if (!id) throw new PayoutAccountError('profileId is required.', 400, 'bad_request');
  const profile = await deps.readProfile(id);
  if (!profile) throw new PayoutAccountError('Profile not found.', 404, 'not_found');
  if (!payholdConfigured()) {
    throw new PayoutAccountError('PayHold is not configured.', 503, 'not_configured');
  }
  return profile;
}

// ---------------------------------------------------------------------------
// GET ?profileId= — the account as PayHold holds it
// ---------------------------------------------------------------------------

export async function readHostPayoutAccount(
  profileId: string,
  deps: AccountDeps,
): Promise<PayoutAccountRead> {
  const profile = await loadProfile(profileId, deps);
  const live = await readLive(profile.id, profile.payhold_seller_id, deps);
  const reason = reasonFor(live);
  if (reason) return { account: null, reason };
  return { account: await toAccount(live.sellerId!, live.destination!, deps) };
}

// ---------------------------------------------------------------------------
// POST { profileId, verified } — re-read, then relay
// ---------------------------------------------------------------------------

/**
 * `verifiedBy` is the caller's — `autohire-admin:<profile id>`, from the session
 * in the handler. Nothing in `body` beyond `profileId` and `verified` is read.
 */
export async function verifyHostPayoutAccount(
  body: Record<string, unknown>,
  verifiedBy: string,
  deps: AccountDeps,
): Promise<PayoutAccountVerifyResult> {
  const profileId = typeof body.profileId === 'string' ? body.profileId : '';
  if (!profileId.trim()) throw new PayoutAccountError('profileId is required.', 400, 'bad_request');
  // Stated, never defaulted: PayHold reads a missing `verified` as true.
  if (typeof body.verified !== 'boolean') {
    throw new PayoutAccountError('verified must be true or false.', 400, 'bad_request');
  }
  const verified = body.verified;

  const profile = await loadProfile(profileId, deps);
  const live = await readLive(profile.id, profile.payhold_seller_id, deps);
  const reason = reasonFor(live);
  if (reason) return { outcome: reason, account: null };
  const sellerId = live.sellerId!;
  const destination = live.destination!;

  let answer: SellerDestination | { destination?: SellerDestination };
  try {
    answer = await setDestinationVerified(sellerId, destination.id, verified, verifiedBy);
  } catch (e) {
    // Exact codes first. A replaced account, or one PayHold cannot find: read
    // again and let the admin look at what is there now.
    const archived = isDestinationArchived(e);
    if (archived || (e instanceof PayHoldError && e.status === 404)) {
      const fresh = await readLive(profile.id, sellerId, deps);
      const freshReason = reasonFor(fresh);
      if (freshReason) return { outcome: freshReason, account: null };
      if (archived || fresh.destination!.id !== destination.id) {
        return { outcome: 'changed', account: await toAccount(fresh.sellerId!, fresh.destination!, deps) };
      }
      throw e;
    }
    // Relay off, or the old PayHold refusing a key on this route. A person in
    // PayHold's settings changes this answer, not a retry.
    if (isDestinationRelayOff(e)) {
      return { outcome: 'not_trusted_yet', account: await toAccount(sellerId, destination, deps) };
    }
    throw e;
  }

  const row = answer && typeof answer === 'object' && 'destination' in answer && answer.destination
    ? answer.destination
    : (answer as SellerDestination);
  const merged: SellerDestination = { ...destination, ...(row ?? {}) };

  // Same rule `payhold-seller` applies on every read — only on an answer
  // PayHold actually gave. Verifying does not end the hold, so this may well
  // stay `pending` until the hold runs out.
  const caps = await sellerCapabilities(sellerId).catch(() => null);
  if (caps) {
    await reconcilePayoutStatus(
      profile.payout_status,
      caps.can_receive_payouts,
      (status) => deps.writePayoutStatus(profile.id, status),
      { profileId: profile.id },
    );
  }

  return {
    outcome: verified ? 'verified' : 'unverified',
    account: await toAccount(sellerId, merged, deps),
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** PayHold's failure, in words an admin can act on. */
function payholdFailure(e: PayHoldError): { status: number; body: Record<string, unknown> } {
  if ([400, 409, 422].includes(e.status)) {
    return {
      status: 422,
      body: { error: `PayHold refused this: ${e.message}`, code: 'payhold_refused', payholdCode: e.code ?? null },
    };
  }
  return {
    status: 502,
    body: {
      error: `Could not get an answer from PayHold (${e.message}). Nothing was saved in AutoHire; it is safe to try again.`,
      code: 'payhold_unavailable',
      payholdCode: e.code ?? null,
    },
  };
}

export async function handlePayoutAccountRequest(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'GET or POST only.' }, 405);
  }

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);
    const uid = await deps.userIdForToken(token);
    if (!uid) return json({ error: 'Invalid or expired session.' }, 401);

    // Admins only, checked here against `profiles.role` — the attestation
    // PayHold records is the operator's, and a host must not read or verify
    // anyone's payout account through this.
    if ((await deps.roleOf(uid)) !== 'admin') {
      return json({ error: "Only an admin can review a host's payout account." }, 403);
    }

    if (req.method === 'GET') {
      const profileId = new URL(req.url).searchParams.get('profileId') ?? '';
      return json(await readHostPayoutAccount(profileId, deps), 200);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Send { profileId, verified }.', code: 'bad_request' }, 400);
    }
    // The verifier is the session's admin. A `verified_by`, `destinationId` or
    // `sellerId` in the body is never read.
    return json(
      await verifyHostPayoutAccount(body as Record<string, unknown>, autohireAdminActor(uid), deps),
      200,
    );
  } catch (e) {
    if (e instanceof PayoutAccountError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof PayHoldError) {
      const { status, body } = payholdFailure(e);
      console.error('[payhold-verify-destination] PayHold refused or was unreachable', {
        status: e.status,
        code: e.code,
        error: e.message,
      });
      return json(body, status);
    }
    console.error('[payhold-verify-destination] failed', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
