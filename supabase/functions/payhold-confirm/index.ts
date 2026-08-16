// AutoHire — payhold-confirm Edge Function.
//
// Tells PayHold that one side is satisfied. When both have, PayHold releases
// the hold into the host's wallet atomically, inside its own transaction —
// there is no separate "release" call for AutoHire to make and no window where
// one could be missed.
//
// The mapping is AutoHire's existing two-sided return handoff:
//
//   the renter marks the car returned  → side=buyer
//   the host marks the car returned    → side=seller
//
// Which side the caller is comes from THEIR SESSION, never from the request. A
// renter who could pass side=seller would release their own deposit by
// confirming on the host's behalf.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-confirm

import { createClient } from 'npm:@supabase/supabase-js@2';
import { confirmDeal, payholdConfigured } from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const uid = userData.user.id;

    const { bookingId, overageOverrideMinor } = await req.json();
    if (!bookingId) return json({ error: 'bookingId is required.' }, 400);
    if (
      overageOverrideMinor !== undefined &&
      overageOverrideMinor !== null &&
      (typeof overageOverrideMinor !== 'number' || overageOverrideMinor < 0)
    ) {
      return json({ error: 'overageOverrideMinor must be a non-negative number.' }, 400);
    }

    const { data: booking } = await admin
      .from('bookings')
      .select('id, renter_id, host_id, state, payhold_deal_id')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return json({ error: 'Booking not found.' }, 404);
    if (!booking.payhold_deal_id) {
      return json({ error: 'This booking was not paid through PayHold.' }, 409);
    }

    // The session decides the side. Anyone who is neither party has no business
    // confirming anything about this trip.
    const side =
      uid === booking.renter_id ? 'buyer' : uid === booking.host_id ? 'seller' : null;
    if (!side) return json({ error: 'You are not part of this booking.' }, 403);

    // Confirming before the trip has run would release the money while the car
    // is still out. PayHold has its own state guard, but refusing here gives a
    // sentence the person can act on rather than an invalid_state code.
    if (!['active', 'completed'].includes(booking.state)) {
      return json(
        { error: 'The trip has not finished yet.', code: 'too_early', state: booking.state },
        409,
      );
    }

    // The host's own lever, and only theirs — PayHold refuses this on the
    // renter's confirmation too, but the sentence here is one a renter
    // sending it (by mistake, or by tampering with the request) can actually
    // act on.
    if (overageOverrideMinor !== undefined && overageOverrideMinor !== null && side !== 'seller') {
      return json({ error: 'Only the host can adjust the overage charge.' }, 403);
    }

    const deal = await confirmDeal(
      booking.payhold_deal_id,
      side,
      overageOverrideMinor === undefined || overageOverrideMinor === null
        ? undefined
        : overageOverrideMinor,
    );

    return json({ dealStatus: deal.status, side, confirmations: deal.confirmations ?? null }, 200);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
