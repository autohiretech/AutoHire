// AutoHire — payhold-cancel-booking Edge Function.
//
// The "Cancel & refund" button on a trip, for the two people who may press it
// before a car has actually gone out: the renter, on their own still-pending
// or accepted booking, and the host, on one they've accepted but not yet
// handed over. Deliberately narrower than payhold-refund (admin/host, any
// reason, any amount, any time): this is the free-cancellation window, not a
// dispute settlement, so the only authority it needs is "this booking hasn't
// started yet, and you are one of its two parties" — checked here again
// rather than trusted from the client, whose idea of the booking's state can
// be stale.
//
// `cancelBooking()` used to just write `state: 'cancelled',
// payment_status: 'refunded'` straight into the bookings table — no call to
// PayHold at all. The booking claimed to be refunded whether or not any money
// actually moved.
//
// Same rule as payhold-refund on writing state: PayHold answers the moment it
// ACCEPTS the refund, not when the money has actually landed. Only the
// `refund.succeeded` webhook may mark a trip cancelled/refunded — writing it
// here too would leave a booking claiming to be refunded after a provider
// transfer that failed. The one exception is a booking with nothing to
// refund (never reached PayHold, or was never charged) — there is no money
// event to wait for, so this writes `cancelled` directly.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-cancel-booking

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PayHoldError, payholdConfigured, refundDeal } from '../_shared/payhold.ts';

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

    const { bookingId } = await req.json().catch(() => ({}));
    if (!bookingId || typeof bookingId !== 'string') {
      return json({ error: 'bookingId is required.' }, 400);
    }

    const { data: booking } = await admin
      .from('bookings')
      .select('id, renter_id, host_id, state, payment_status, payhold_deal_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking) return json({ error: 'Booking not found.' }, 404);

    const isRenter = uid === booking.renter_id;
    const isHost = uid === booking.host_id;
    if (!isRenter && !isHost) {
      return json({ error: 'You are not part of this booking.', code: 'not_allowed' }, 403);
    }

    if (['cancelled', 'declined', 'completed'].includes(booking.state as string)) {
      return json(
        { error: 'This booking cannot be cancelled.', code: 'invalid_state', state: booking.state },
        409,
      );
    }

    // Mirrors TripDetailPage's own `canCancel` — a renter may step back any
    // time before pickup starts; a host may only step back on a trip they've
    // accepted but not yet handed over. Re-checked here because this is the
    // only thing standing between "before the trip" and refunding one already
    // under way.
    const allowed = isHost
      ? ['confirmed', 'pickup'].includes(booking.state as string)
      : ['requested', 'confirmed'].includes(booking.state as string);
    if (!allowed) {
      return json(
        {
          error: 'This trip has already started and can no longer be cancelled here.',
          code: 'too_late',
          state: booking.state,
        },
        409,
      );
    }

    // Nothing was ever taken — a plain cancel, no PayHold call and nothing to
    // wait on a webhook for.
    if (!booking.payhold_deal_id || booking.payment_status !== 'paid') {
      const { error } = await admin
        .from('bookings')
        .update({ state: 'cancelled' })
        .eq('id', bookingId);
      if (error) return json({ error: error.message }, 500);
      return json({ cancelled: true, refunded: false }, 200);
    }

    try {
      const reason = isHost ? 'Cancelled by host before pickup' : 'Cancelled by renter before pickup';
      const deal = await refundDeal(booking.payhold_deal_id as string, reason);
      return json(
        {
          cancelled: true,
          refunded: false,
          pending: true,
          dealStatus: deal.status,
          message: 'Refund sent to PayHold — the booking updates once the money lands.',
        },
        200,
      );
    } catch (e) {
      // PayHold refuses a refund once the money has left it. Not a bug to
      // surface as a 500 — the next step is a dispute, not a retry.
      const message = e instanceof PayHoldError ? e.message : String(e);
      const status = e instanceof PayHoldError ? e.status : 502;
      if (/paid_out|invalid_state/i.test(message)) {
        return json(
          {
            error:
              'This money has already been paid out and cannot be refunded here. Open a dispute to claw it back.',
            code: 'too_late',
            detail: message,
          },
          409,
        );
      }
      return json({ error: message, code: 'payhold_refused' }, status);
    }
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
