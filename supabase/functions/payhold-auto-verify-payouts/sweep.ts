// AutoHire — payhold-auto-verify-payouts: the sweep, kept apart from the HTTP
// shell in `index.ts` so it runs over injected deps and a stubbed `fetch`.
//
// **What this is for.** Two checks stand between a host and their money: the
// person is verified, and the payout account is verified. Migration 081 made
// the first carry the second, which covers a host being reviewed. It does not
// cover the case that actually stops earnings — a host verified months ago
// changes their MoMo number. PayHold archives the old destination, the new one
// arrives unverified, `route_payout` refuses it, and nobody in AutoHire is
// told. The host finds out; the admin finds out from the host.
//
// So `app_settings.payout_auto_verify_after_hours` is a standing instruction:
// a payout account that has been on file that long, with no admin verifying or
// rejecting it, is verified. 0 means never.
//
// **The narrow parts, deliberately narrow:**
//
//   * only a host whose own `verification` says `verified`, who is not
//     suspended, and whose `payout_status` is `pending` — the payout account is
//     the second check and never the first, and this cannot verify a person;
//   * the clock is PayHold's `created_at` on the destination, read fresh every
//     run. AutoHire keeps no copy to drift, and an account with no `created_at`
//     (an older PayHold) is left for an admin rather than guessed at;
//   * PayHold's §5.1 security hold is untouched — nothing sent from AutoHire
//     can shorten it — so the takeover this would otherwise help still waits
//     out the hold before a transfer;
//   * the verifier is `autohire-auto-verify:<hours>h`, never an admin's name:
//     PayHold's audit row and the admin's card both say a rule let it through.
//
// Idempotent and clock-bound: running it twice, or early, verifies nothing
// early. That is what lets the endpoint be callable without a key.

import {
  PayHoldError,
  autohireAutoVerifyActor,
  isDestinationArchived,
  isDestinationRelayOff,
  isSellerGone,
  liveDestination,
  payholdConfigured,
  sellerCapabilities,
  sellerDestinations,
  setDestinationVerified,
} from '../_shared/payhold.ts';
import { reconcilePayoutStatus } from '../_shared/payout-status.ts';

/** At most this many hosts per run — a sweep is not a migration. */
export const MAX_PER_RUN = 200;

/** A second call inside this window does nothing. Cheap defence for a keyless route. */
export const MIN_MINUTES_BETWEEN_RUNS = 5;

export interface AutoVerifySettings {
  /** `app_settings.payout_auto_verify_after_hours`. 0 = off. */
  afterHours: number;
  lastRunAt: string | null;
}

/** A host who might be waiting: verified, not suspended, a seller, `payout_status = 'pending'`. */
export interface CandidateHost {
  id: string;
  sellerId: string;
  payoutStatus: string | null;
}

export interface SweepDeps {
  readSettings: () => Promise<AutoVerifySettings>;
  candidates: (limit: number) => Promise<CandidateHost[]>;
  /** Write `profiles.payout_status`. */
  writePayoutStatus: (profileId: string, status: string) => Promise<void>;
  /** Tell the host their account went through — `create_notification`. */
  notifyHost: (profileId: string, title: string, body: string) => Promise<void>;
  /** Stamp `payout_auto_verify_last_run_at` / `_last_count`. */
  markRun: (at: Date, verified: number) => Promise<void>;
  now?: () => Date;
}

export type SweepSkipReason = 'off' | 'too_soon' | 'not_configured';

export interface SweepResult {
  ran: boolean;
  /** Why nothing was swept. Absent on a run. */
  reason?: SweepSkipReason;
  afterHours: number;
  /** Hosts looked at. */
  checked: number;
  /** Accounts verified in PayHold this run. */
  verified: number;
  /** On file, but not long enough yet. */
  waiting: number;
  /** Already verified — an admin got there first, or an earlier run did. */
  already: number;
  /** No live payout account to verify (including a link PayHold no longer knows). */
  noAccount: number;
  /** PayHold returned no `created_at`, so the wait cannot be measured. Left for an admin. */
  unknownAge: number;
  /** PayHold refused or was unreachable for this host. Next run tries again. */
  failed: number;
  /** PayHold is not taking payout-account decisions from AutoHire; the sweep stopped. */
  relayOff: boolean;
}

function empty(afterHours: number, reason: SweepSkipReason): SweepResult {
  return {
    ran: false,
    reason,
    afterHours,
    checked: 0,
    verified: 0,
    waiting: 0,
    already: 0,
    noAccount: 0,
    unknownAge: 0,
    failed: 0,
    relayOff: false,
  };
}

/**
 * One pass. Never throws for one host's sake: a PayHold refusal on one account
 * is counted and the next host is tried, because the run is a queue and not a
 * transaction. The two things that do stop it are the relay being off (every
 * remaining call would be refused the same way) and a failure to read the
 * settings at all.
 */
export async function runAutoVerifySweep(deps: SweepDeps): Promise<SweepResult> {
  const now = deps.now?.() ?? new Date();
  const settings = await deps.readSettings();
  const afterHours = Number.isFinite(settings.afterHours) ? Math.max(0, settings.afterHours) : 0;

  if (afterHours <= 0) return empty(afterHours, 'off');
  if (!payholdConfigured()) return empty(afterHours, 'not_configured');

  const last = settings.lastRunAt ? Date.parse(settings.lastRunAt) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < MIN_MINUTES_BETWEEN_RUNS * 60_000) {
    return empty(afterHours, 'too_soon');
  }

  const result: SweepResult = {
    ran: true,
    afterHours,
    checked: 0,
    verified: 0,
    waiting: 0,
    already: 0,
    noAccount: 0,
    unknownAge: 0,
    failed: 0,
    relayOff: false,
  };

  const hosts = await deps.candidates(MAX_PER_RUN);
  const actor = autohireAutoVerifyActor(afterHours);
  const cutoff = now.getTime() - afterHours * 3_600_000;

  for (const host of hosts) {
    result.checked += 1;
    try {
      const { destinations } = await sellerDestinations(host.sellerId);
      const destination = liveDestination(destinations);

      if (!destination) {
        result.noAccount += 1;
        continue;
      }

      // An admin already decided, or an earlier run did. Ask PayHold whether
      // this host is payable now, so a stale `pending` stops bringing them back
      // here every hour — but not while the hold is still running, when the
      // answer is known to be no.
      if (destination.verified_at) {
        result.already += 1;
        const held = destination.security_hold_until
          ? Date.parse(destination.security_hold_until) > now.getTime()
          : false;
        if (!held) await settleStatus(host, deps);
        continue;
      }

      const created = destination.created_at ? Date.parse(destination.created_at) : NaN;
      if (!Number.isFinite(created)) {
        result.unknownAge += 1;
        console.warn(
          '[payhold-auto-verify-payouts] destination has no created_at; left for an admin',
          { profileId: host.id, destinationId: destination.id },
        );
        continue;
      }
      if (created > cutoff) {
        result.waiting += 1;
        continue;
      }

      await setDestinationVerified(host.sellerId, destination.id, true, actor);
      result.verified += 1;
      console.log('[payhold-auto-verify-payouts] verified after the wait', {
        profileId: host.id,
        sellerId: host.sellerId,
        destinationId: destination.id,
        afterHours,
      });
      const payable = await settleStatus(host, deps);
      await tellHost(host, destination, payable, now, deps);
    } catch (e) {
      // Every remaining host would be refused the same way, so stop rather than
      // spend the run finding that out 200 times. A person in PayHold's
      // settings changes this answer; a retry does not.
      if (isDestinationRelayOff(e)) {
        result.relayOff = true;
        console.error(
          '[payhold-auto-verify-payouts] PayHold is not taking payout-account decisions from AutoHire — sweep stopped',
        );
        break;
      }
      // A link to a seller PayHold no longer has (a sandbox reset). Not repaired
      // from here: the host's own payout screens do that, visibly, and this runs
      // where nobody is looking.
      if (isSellerGone(e)) {
        result.noAccount += 1;
        console.warn('[payhold-auto-verify-payouts] payhold_seller_id is unknown to PayHold', {
          profileId: host.id,
          sellerId: host.sellerId,
        });
        continue;
      }
      // The host replaced the account between the read and the verify. The new
      // one starts its own wait.
      if (isDestinationArchived(e)) {
        result.waiting += 1;
        continue;
      }
      result.failed += 1;
      console.error('[payhold-auto-verify-payouts] host failed', {
        profileId: host.id,
        status: e instanceof PayHoldError ? e.status : undefined,
        code: e instanceof PayHoldError ? e.code : undefined,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await deps.markRun(now, result.verified).catch((e) => {
    console.error('[payhold-auto-verify-payouts] could not stamp the run', e);
  });

  return result;
}

/**
 * `profiles.payout_status` against what PayHold says now — the same
 * reconciliation `payhold-seller` and `payhold-verify-destination` do, on an
 * answer PayHold actually gave. A failure here is logged, never fatal: the
 * account is verified either way, and the column catches up on the next read.
 */
async function settleStatus(host: CandidateHost, deps: SweepDeps): Promise<boolean | null> {
  const caps = await sellerCapabilities(host.sellerId).catch(() => null);
  if (!caps) return null;
  await reconcilePayoutStatus(
    host.payoutStatus,
    caps.can_receive_payouts,
    (status) => deps.writePayoutStatus(host.id, status),
    { profileId: host.id, source: 'payhold-auto-verify-payouts' },
  );
  return caps.can_receive_payouts;
}

/**
 * The host hears about it, because nobody else will.
 *
 * This is the one verification in the system that happens with no person on
 * either side of it: the host saved an account and waited, no admin opened it,
 * and a cron let it through. Their earnings screen had been saying "being
 * checked" the whole time. What the message must not do is promise money is
 * moving — a verified account still waits out PayHold's security hold — so the
 * wording follows `can_receive_payouts` rather than the verification.
 *
 * A failure here is logged and swallowed: the account is verified either way,
 * and re-running the sweep must not re-verify anything to retry a message.
 */
async function tellHost(
  host: CandidateHost,
  destination: { security_hold_until?: string | null },
  payable: boolean | null,
  now: Date,
  deps: SweepDeps,
): Promise<void> {
  const hold = destination.security_hold_until
    ? Date.parse(destination.security_hold_until)
    : NaN;
  const stillHeld = Number.isFinite(hold) && hold > now.getTime();
  const body = payable === true && !stillHeld
    ? 'Your payout account has been verified. Your earnings can be paid out from now on.'
    : stillHeld
      ? 'Your payout account has been verified. New and changed accounts wait out a short security hold before their first payout — yours ends on its own.'
      : 'Your payout account has been verified. If anything else is still outstanding, your earnings screen says what.';
  await deps
    .notifyHost(host.id, 'Your payout account is verified', body)
    .catch((e) => {
      console.error('[payhold-auto-verify-payouts] could not notify the host', {
        profileId: host.id,
        error: e instanceof Error ? e.message : String(e),
      });
    });
}
