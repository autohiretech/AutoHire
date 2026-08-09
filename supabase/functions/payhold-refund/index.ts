// AutoHire — payhold-refund Edge Function.
//
// Sends a renter's money back, in full or in part. This is the last of the
// PayHold client's calls to have no caller: `refundDeal` was written with the
// adapter and never wired, so a refund could only be done by hand in PayHold's
// dashboard, leaving AutoHire's booking claiming to be paid.
//
// Who may call it, and why not everyone:
//
//   admin  — always. Refunding is how a decided dispute is actually settled.
//   host   — their own bookings. A host who cancels on a renter must be able to
//            give the money back without waiting on support.
//   renter — never. A renter refunding themselves mid-trip is not a refund, it
//            is a chargeback with extra steps; they open a dispute instead
//            (`payhold-dispute`), which freezes the payout for a person to
//            decide rather than moving money on one party's say-so.
//
// AutoHire does NOT write the booking's new state here. PayHold answers this
// call the moment it accepts the refund, not when the provider has actually
// returned the money — the `refund.succeeded` webhook is what says it landed,
// and that is the only thing allowed to mark a trip refunded. Writing it here
// too would mean a failed provider transfer left a booking cancelled and a
// renter with no car and no money.
//
//   POST /payhold-refund   { bookingId, reason, amount? }
//
// `amount` is in WHOLE units of the booking's charge currency, as the rest of
// AutoHire stores money; the minor-unit conversion happens here. Omit it to
// refund the full remaining balance.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-refund

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  PayHoldError,
  payholdConfigured,
  refundDeal,
  toMinorUnits,
} from '../_shared/payhold.ts';

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
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

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

    const body = await req.json().catch(() => ({}));
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const amount = typeof body.amount === 'number' ? body.amount : undefined;

    if (!bookingId) return json({ error: 'bookingId is required.' }, 400);
    if (reason.length < 4) {
      // The reason travels to PayHold and sits on the deal forever. It is what
      // an operator reads months later when the renter asks why.
      return json({ error: 'Give a reason for the refund.' }, 400);
    }
    if (amount !== undefined && !(amount > 0)) {
      return json({ error: 'amount must be greater than zero, or omitted for a full refund.' }, 400);
    }

    const { data: booking } = await admin
      .from('bookings')
      .select('id, renter_id, host_id, total_rwf, charge_currency, payhold_deal_id, payment_status')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return json({ error: 'Booking not found.' }, 404);

    const { data: caller } = await admin
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .single();

    const isAdmin = caller?.role === 'admin';
    const isHost = uid === booking.host_id;
    if (!isAdmin && !isHost) {
      return json(
        {
          error:
            uid === booking.renter_id
              ? 'Ask the host to cancel, or open a dispute if something went wrong.'
              : 'You are not part of this booking.',
          code: 'not_allowed',
        },
        403,
      );
    }

    if (!booking.payhold_deal_id) {
      return json(
        { error: 'This booking was not paid through PayHold.', code: 'no_deal' },
        409,
      );
    }
    if (booking.payment_status === 'refunded') {
      return json({ error: 'This booking has already been refunded.', code: 'already_refunded' }, 409);
    }

    const currency = (booking.charge_currency as string | null) ?? 'RWF';

    // A partial refund larger than the trip is a typo, and PayHold would take
    // it as far as its own balance check. Caught here so the message names the
    // number the person actually typed.
    if (amount !== undefined && booking.total_rwf && amount > (booking.total_rwf as number)) {
      return json(
        {
          error: `That is more than the booking was for (${booking.total_rwf} ${currency}).`,
          code: 'amount_too_large',
        },
        400,
      );
    }

    let deal;
    try {
      deal = await refundDeal(
        booking.payhold_deal_id as string,
        reason,
        amount === undefined ? undefined : toMinorUnits(amount, currency),
      );
    } catch (e) {
      // PayHold refuses a refund once the money has left it — released to the
      // host's wallet and paid out. That is not a bug to surface as a 500; it
      // is an answer, and the next step is a dispute, not a retry.
      const message = e instanceof PayHoldError ? e.message : String(e);
      const status = e instanceof PayHoldError ? e.status : 502;
      if (/paid_out|invalid_state/i.test(message)) {
        return json(
          {
            error:
              'This money has already been paid out and cannot be refunded. Open a dispute to claw it back.',
            code: 'too_late',
            detail: message,
          },
          409,
        );
      }
      return json({ error: message, code: 'payhold_refused' }, status);
    }

    // Deliberately no booking write — see the note at the top of this file. The
    // status is returned so the caller can say "refund on its way" honestly
    // rather than "refunded".
    return json(
      {
        dealId: deal.id,
        dealStatus: deal.status,
        partial: amount !== undefined,
        amount: amount ?? null,
        currency,
        message:
          amount === undefined
            ? 'Full refund sent to PayHold. The booking updates when the money lands.'
            : `Refund of ${amount} ${currency} sent to PayHold. The booking updates when the money lands.`,
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
