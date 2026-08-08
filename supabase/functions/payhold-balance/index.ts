// AutoHire — payhold-balance Edge Function.
//
//   GET   → this host's wallet, straight from PayHold
//   POST  → withdraw the cleared money
//
// The balance is READ, never stored. PayHold owns the ledger; a mirrored copy
// in AutoHire would drift the first time a webhook was missed, and a wrong
// balance is worse than a slow one — a host who sees money that is not there
// makes plans against it.
//
// A host can only ever address their own seller record: the id is looked up
// from their session, never taken from the request. Passing a seller id in
// would let any host read any other host's earnings.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-balance

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  PayHoldError,
  payholdConfigured,
  sellerBalance,
  sellerCapabilities,
  withdraw,
} from '../_shared/payhold.ts';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!payholdConfigured()) {
      return json({ error: 'PayHold is not configured.', code: 'not_configured' }, 503);
    }

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);

    const { data: profile } = await admin
      .from('profiles')
      .select('role, payhold_seller_id')
      .eq('id', userData.user.id)
      .single();

    if (profile?.role !== 'owner') {
      return json({ error: 'Only hosts have earnings.' }, 403);
    }

    const sellerId = profile?.payhold_seller_id as string | null;
    if (!sellerId) {
      // Not an error — a host who has not set up payouts has an empty wallet,
      // and the screen should say so rather than show a failure.
      return json(
        { sellerId: null, balances: [], withdrawable: [], canReceivePayouts: false, reasons: [] },
        200,
      );
    }

    if (req.method === 'POST') {
      try {
        const result = await withdraw(sellerId);
        return json(
          {
            requested: result.requested,
            payouts: result.payouts,
            message: `${result.requested} payout${result.requested === 1 ? '' : 's'} on the way.`,
          },
          200,
        );
      } catch (e) {
        // "Nothing cleared" is a normal answer for a host who checks early, not
        // a failure — but PayHold raises rather than returning zero, and the
        // raw message is a Postgres string carrying their seller uuid. Shown as
        // a red error toast it would read like a bug. Translated here.
        const message = e instanceof PayHoldError ? e.message : '';
        if (/nothing cleared/i.test(message)) {
          return json(
            {
              requested: 0,
              payouts: [],
              message:
                'Nothing has cleared yet. Money becomes available once the clearance window ends.',
            },
            200,
          );
        }
        throw e;
      }
    }

    const [wallet, caps] = await Promise.all([
      sellerBalance(sellerId),
      sellerCapabilities(sellerId).catch(() => null),
    ]);

    // PayHold speaks snake_case; the app's types are camelCase. Mapped here
    // rather than in the browser so the shape crossing the wire is the shape
    // `PayholdWallet` declares.
    return json(
      {
        sellerId,
        balances: wallet.balances.map((b) => ({
          currency: b.currency,
          held: b.held,
          pendingClearance: b.pending_clearance,
          available: b.available,
          reserved: b.reserved,
          paidOut: b.paid_out,
        })),
        withdrawable: wallet.withdrawable.map((w) => ({
          currency: w.currency,
          availableAmount: w.available_amount,
          availableCount: w.available_count,
          requestedAmount: w.requested_amount,
          requestedCount: w.requested_count,
          clearingAmount: w.clearing_amount,
          clearingCount: w.clearing_count,
          heldCount: w.held_count,
          needsVerificationCount: w.needs_verification_count,
          blockedCount: w.blocked_count,
          paidAmount: w.paid_amount,
          paidCount: w.paid_count,
        })),
        canReceivePayouts: caps?.can_receive_payouts ?? false,
        kycStatus: caps?.kyc_status ?? 'pending',
        reasons: caps?.reasons ?? [],
        routeReasons: caps?.route_reasons ?? [],
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
