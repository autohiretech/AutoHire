// AutoHire — payhold-settle-usage Edge Function.
//
// Turns the pickup/return handoff timestamps that already exist
// (pickup_renter_at/pickup_host_at/return_renter_at/return_host_at, stamped by
// confirm_handoff()) into the numbers an hourly rental or a late daily return
// actually cost. Called once a trip reaches 'completed' — see confirmHandoff()
// in web/src/lib/supabaseClient.ts, the same place payhold-confirm already
// fires from, best-effort, on the return handoff.
//
// What it does with the answer differs by how the booking was priced:
//
//   hourly — the renter paid a 50% deposit against an ESTIMATE. If actual use
//            cost less, the difference is refunded through PayHold right now
//            (refundDeal, on the original deposit deal) — that's returning
//            money PayHold already holds, the one thing this system still does
//            automatically. If actual use cost MORE, the difference is
//            recorded in amount_owed_rwf and nothing is charged: PayHold has
//            no way to add money to a deal it has already funded, and
//            collecting it is the host's job outside this system.
//
//   daily  — no money moves either way. A return more than the 2-hour grace
//            past the agreed time (end_date + expected_return_time) writes
//            the overage to amount_owed_rwf, display-only, same reasoning.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-settle-usage

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PayHoldError, payholdConfigured, refundDeal, toMinorUnits } from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// A day booking coming back within this many hours of the agreed time is on
// time. Past it, every extra hour is billed at the listing's overage rate.
// Fixed for this pass rather than a per-listing setting — see the plan.
const OVERAGE_GRACE_HOURS = 2;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
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

    const { bookingId } = await req.json();
    if (!bookingId) return json({ error: 'bookingId is required.' }, 400);

    const { data: booking } = await admin
      .from('bookings')
      .select(
        'id, renter_id, host_id, state, rental_type, end_date, expected_return_time, price_per_hour_rwf, overage_rate_rwf, deposit_amount_rwf, total_rwf, charge_currency, payhold_deal_id, actual_hours, final_amount_rwf, amount_owed_rwf, pickup_renter_at, pickup_host_at, return_renter_at, return_host_at',
      )
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return json({ error: 'Booking not found.' }, 404);
    if (uid !== booking.renter_id && uid !== booking.host_id) {
      return json({ error: 'You are not part of this booking.' }, 403);
    }
    if (booking.state !== 'completed') {
      return json({ error: 'The trip has not finished yet.', code: 'too_early', state: booking.state }, 409);
    }

    // Already settled — return what was already computed rather than doing it
    // (and any refund) twice. Both sides confirming return can each trigger
    // this call; only the second one that actually sees 'completed' matters,
    // but a redelivery or a slow second request should still be a no-op.
    if (booking.actual_hours != null) {
      return json(
        {
          actualHours: booking.actual_hours,
          finalAmountRwf: booking.final_amount_rwf,
          amountOwedRwf: booking.amount_owed_rwf,
          alreadySettled: true,
        },
        200,
      );
    }

    const pickupAt = latestOf(booking.pickup_renter_at, booking.pickup_host_at);
    const returnAt = latestOf(booking.return_renter_at, booking.return_host_at);
    if (!pickupAt || !returnAt) {
      // Shouldn't happen — confirm_handoff only reaches 'completed' once both
      // pairs are stamped — but a booking created before this feature existed
      // could have pickup_at values with no rental_type-aware settlement path.
      return json({ error: 'Handoff timestamps are incomplete.' }, 409);
    }

    const actualHours = Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 3_600_000));

    let finalAmount: number | null = null;
    let amountOwed = 0;
    let refunded: number | null = null;

    if (booking.rental_type === 'hourly') {
      const rate = Number(booking.price_per_hour_rwf ?? 0);
      const deposit = Number(booking.deposit_amount_rwf ?? 0);
      finalAmount = actualHours * rate;
      const diff = deposit - finalAmount; // positive: renter overpaid the deposit

      if (diff > 0 && booking.payhold_deal_id) {
        const currency = (booking.charge_currency as string | null) ?? 'RWF';
        try {
          await refundDeal(
            booking.payhold_deal_id as string,
            'Hourly rental settled: actual time used came in under the deposit estimate.',
            toMinorUnits(diff, currency),
          );
          refunded = diff;
        } catch (e) {
          // Don't write settlement numbers on a failed refund — leaving
          // actual_hours null keeps the idempotency guard above open so a
          // retry can still attempt the refund instead of silently dropping
          // it once the booking looks "settled".
          const message = e instanceof PayHoldError ? e.message : String(e);
          console.error('payhold-settle-usage: refund failed', { bookingId, diff, message });
          return json({ error: `Could not refund the deposit difference: ${message}`, code: 'refund_failed' }, 502);
        }
      } else if (diff < 0) {
        amountOwed = -diff;
      }
    } else if (booking.expected_return_time) {
      // Naive, same as the rest of this schema — no per-market timezone
      // handling exists anywhere else in AutoHire either. Postgres reads a
      // `time` column back as "HH:MM:SS"; slice to "HH:MM" so appending our
      // own ":00Z" below can't double up on seconds.
      const hhmm = String(booking.expected_return_time).slice(0, 5);
      const agreedReturnAt = new Date(`${booking.end_date}T${hhmm}:00Z`);
      const excessMs = returnAt.getTime() - agreedReturnAt.getTime();
      if (excessMs > OVERAGE_GRACE_HOURS * 3_600_000) {
        const overageHours = Math.ceil(excessMs / 3_600_000);
        amountOwed = overageHours * Number(booking.overage_rate_rwf ?? 0);
      }
    }

    await admin
      .from('bookings')
      .update({
        actual_hours: actualHours,
        final_amount_rwf: finalAmount,
        amount_owed_rwf: amountOwed,
      })
      .eq('id', bookingId);

    return json({ actualHours, finalAmountRwf: finalAmount, amountOwedRwf: amountOwed, refundedRwf: refunded }, 200);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});

function latestOf(a: string | null, b: string | null): Date | null {
  if (!a && !b) return null;
  const ta = a ? new Date(a).getTime() : -Infinity;
  const tb = b ? new Date(b).getTime() : -Infinity;
  return new Date(Math.max(ta, tb));
}
