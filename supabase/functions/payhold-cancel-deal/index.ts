// AutoHire — payhold-cancel-deal Edge Function.
//
// The close button on the payment sheet, for a deal that never took money.
//
// Closing the sheet used to just unmount a modal. The deal PayHold had
// already created stayed at `created`/`checkout_started` forever, which is
// where PayHold's ~40 orphaned "Not paid yet / At checkout" rows came from,
// and the local booking sat in the renter's trips looking like a real trip
// they never started.
//
// Deliberately NOT payhold-cancel-booking. That one is the post-money refund
// path — a trip that exists, was paid for, and is being unwound before
// pickup, where the money has to come back through a refund and a webhook.
// This is the other side of the line: nothing was ever charged, so there is
// nothing to refund and no money event to wait for. Conflating them would
// mean a refund path that sometimes refunds nothing, and a cancel path that
// sometimes moves money.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-cancel-deal

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PayHoldError, cancelDeal, payholdConfigured } from '../_shared/payhold.ts';

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

    const { dealId, bookingId } = await req.json().catch(() => ({}));
    if (!dealId || typeof dealId !== 'string') {
      return json({ error: 'dealId is required.' }, 400);
    }

    // The deal id arrives from the client, so ownership is established from
    // our own table rather than taken on the caller's word: a booking row
    // carrying this deal id, belonging to this user. A deal with no local
    // booking yet is still cancellable by the person the sheet was opened
    // for — the row is written after payment on some paths — but then there
    // is nothing local to tidy up either.
    const { data: booking } = await admin
      .from('bookings')
      .select('id, renter_id, state, payment_status, payhold_deal_id')
      .eq('payhold_deal_id', dealId)
      .maybeSingle();

    if (booking && booking.renter_id !== uid) {
      return json({ error: 'You are not part of this booking.', code: 'not_allowed' }, 403);
    }
    if (booking && booking.payment_status === 'paid') {
      return json(
        {
          error: 'This booking is paid — cancel it from your trip instead.',
          code: 'already_paid',
        },
        409,
      );
    }

    try {
      const deal = await cancelDeal(dealId, 'Renter closed the payment sheet');

      // Only now, and only because PayHold said so. The local row is a
      // consequence of PayHold's state, never a guess at it — writing
      // `cancelled` before the call could leave a booking marked dead while
      // the deal it points at is still alive and chargeable.
      let removed = false;
      if (booking && (bookingId === undefined || bookingId === booking.id)) {
        const { error } = await admin.from('bookings').delete().eq('id', booking.id);
        if (error) {
          // The deal is genuinely cancelled even if the tidy-up failed, so
          // report success for the part that moved and say what did not.
          return json(
            {
              cancelled: true,
              removed: false,
              dealStatus: deal.status,
              warning: `Deal cancelled, but the local booking could not be removed: ${error.message}`,
            },
            200,
          );
        }
        removed = true;
      }

      return json({ cancelled: true, removed, dealStatus: deal.status }, 200);
    } catch (e) {
      const message = e instanceof PayHoldError ? e.message : String(e);
      const status = e instanceof PayHoldError ? e.status : 502;

      // A mobile-money push already sent is the one refusal that is not an
      // error: the renter may still approve it on their phone, and
      // settle-pending will resolve it either way. The booking MUST survive —
      // deleting it here would hide money that is still on its way.
      if (/payment_pending|in flight/i.test(message)) {
        return json(
          {
            cancelled: false,
            removed: false,
            code: 'payment_in_flight',
            error:
              'A payment is already on its way for this booking. Finish or decline it on your phone — we will update the trip either way.',
          },
          409,
        );
      }

      // Funded or later: money exists, so this is a refund question, not a
      // cancel one, and it belongs to payhold-cancel-booking.
      if (/invalid_state/i.test(message)) {
        return json(
          {
            cancelled: false,
            removed: false,
            code: 'invalid_state',
            error: 'This booking has already been paid and cannot be cancelled here.',
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
