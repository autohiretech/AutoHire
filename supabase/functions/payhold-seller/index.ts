// AutoHire — payhold-seller Edge Function.
//
// The seller resource. A PayHold "seller" IS an AutoHire host — one host, one
// seller record, and that record is what decides whether they can be paid at
// all. Until this existed the seller surface was scattered: the id was written
// by `payhold-register-seller`, the capabilities came back as a side-effect of
// `payhold-balance`, and the destinations only ever arrived bundled inside the
// earnings page. A host asking "is my payout account actually working?" had no
// endpoint that answered it.
//
// Money is deliberately NOT here. Balances and withdrawals stay in
// `payhold-balance` — this answers "who am I to PayHold and can it pay me",
// which is a question with a different shape and a different refresh rate.
//
// Routes
//   GET /payhold-seller               the whole record: id, KYC, capabilities,
//                                     destinations, and what AutoHire stored
//   GET /payhold-seller/capabilities  just the can-I-be-paid answer
//   GET /payhold-seller/destinations  just where the money can go
//
// A host addresses only their own record: the seller id is looked up from their
// session and never read off the request. An admin — and only an admin — may
// pass ?hostId= to look at someone else's, because "why has this host not been
// paid" is a support question that otherwise has to be answered from PayHold's
// dashboard with no AutoHire context beside it.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-seller

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  payholdConfigured,
  sellerCapabilities,
  sellerDestinations,
} from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** PayHold speaks snake_case; `PayoutDestination` in the app is camelCase. */
function toDestination(d: {
  id: string;
  label: string | null;
  country: string;
  payout_currency: string;
  masked_destination: string;
  is_primary: boolean;
  is_backup: boolean;
  verified_at: string | null;
  security_hold_until: string | null;
}) {
  return {
    id: d.id,
    label: d.label,
    country: d.country,
    payoutCurrency: d.payout_currency,
    maskedDestination: d.masked_destination,
    isPrimary: d.is_primary,
    isBackup: d.is_backup,
    verifiedAt: d.verified_at,
    securityHoldUntil: d.security_hold_until,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'GET only.' }, 405);

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
    const uid = userData.user.id;

    const url = new URL(req.url);
    const sub = url.pathname.split('/').filter(Boolean)[1] ?? '';
    const askedFor = url.searchParams.get('hostId');

    const { data: caller } = await admin
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .single();

    // Whose record this is. Anyone but an admin gets their own, whatever they
    // asked for — a host who could name another host's id would read where a
    // competitor gets paid and how much of it is stuck.
    let subjectId = uid;
    if (askedFor && askedFor !== uid) {
      if (caller?.role !== 'admin') {
        return json({ error: 'You can only read your own payout account.' }, 403);
      }
      subjectId = askedFor;
    }

    const { data: profile } = await admin
      .from('profiles')
      .select(
        'id, full_name, business_name, role, country, payhold_seller_id, payout_method, payout_destination, payout_label, payout_status',
      )
      .eq('id', subjectId)
      .maybeSingle();

    if (!profile) return json({ error: 'Profile not found.' }, 404);
    if (profile.role !== 'owner') {
      return json({ error: 'Only host accounts have a seller record.' }, 403);
    }

    const sellerId = profile.payhold_seller_id as string | null;

    // Not an error. A host who has not registered a payout destination has no
    // seller record yet, and the screen that asks should say "connect payouts"
    // rather than render a failure — this is the state every host starts in.
    if (!sellerId) {
      const empty = {
        sellerId: null,
        registered: false,
        canReceivePayouts: false,
        kycStatus: 'unregistered',
        reasons: ['This host has not connected a payout destination yet.'],
        routeReasons: [],
        destinations: [],
      };
      if (sub === 'capabilities') {
        const { destinations: _d, ...caps } = empty;
        return json(caps, 200);
      }
      if (sub === 'destinations') return json({ sellerId: null, destinations: [] }, 200);
      return json(
        {
          ...empty,
          host: {
            id: profile.id,
            name: (profile.business_name as string | null) ?? profile.full_name,
            country: profile.country,
          },
          payout: {
            method: profile.payout_method,
            maskedDestination: profile.payout_destination,
            label: profile.payout_label,
            status: profile.payout_status,
          },
        },
        200,
      );
    }

    if (sub === 'capabilities') {
      const caps = await sellerCapabilities(sellerId);
      return json(
        {
          sellerId,
          registered: true,
          canReceivePayouts: caps.can_receive_payouts,
          kycStatus: caps.kyc_status,
          reasons: caps.reasons ?? [],
          routeReasons: caps.route_reasons ?? [],
        },
        200,
      );
    }

    if (sub === 'destinations') {
      const { destinations } = await sellerDestinations(sellerId);
      return json({ sellerId, destinations: destinations.map(toDestination) }, 200);
    }

    if (sub) return json({ error: `Unknown route /${sub}.` }, 404);

    // The whole record. Both reads are tolerated failing independently: a host
    // whose destinations call times out should still be told their KYC state,
    // and vice versa. Half an answer beats a spinner that never resolves.
    const [caps, dests] = await Promise.all([
      sellerCapabilities(sellerId).catch(() => null),
      sellerDestinations(sellerId).catch(() => null),
    ]);

    return json(
      {
        sellerId,
        registered: true,
        host: {
          id: profile.id,
          name: (profile.business_name as string | null) ?? profile.full_name,
          country: profile.country,
        },
        // What AutoHire wrote down at registration — a mask and a label, never
        // the destination itself. PayHold holds the token.
        payout: {
          method: profile.payout_method,
          maskedDestination: profile.payout_destination,
          label: profile.payout_label,
          status: profile.payout_status,
        },
        canReceivePayouts: caps?.can_receive_payouts ?? false,
        kycStatus: caps?.kyc_status ?? 'unknown',
        reasons: caps?.reasons ?? [],
        routeReasons: caps?.route_reasons ?? [],
        // Null, not [], when PayHold could not be reached — an empty list means
        // "nowhere to be paid", which is a different and much more alarming
        // thing to show a host than "we could not check just now".
        destinations: dests ? dests.destinations.map(toDestination) : null,
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
