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
//   hourly, full-upfront deal (payhold-create-deal set overage_rate and no
//            split_percent — every hourly deal created since the 50/50 split
//            was retired) — the full estimate was already charged at
//            booking. Any time beyond it is collected automatically by
//            PayHold itself, on the card the renter paid with, the instant
//            both sides confirm the trip is over — or the trip pauses
//            pending the host, for a renter with no saved card (mobile money
//            has no reusable credential). That covers on-time and late
//            returns on its own. It cannot cover an EARLY one: PayHold's
//            overage can only ever add to what was charged, never subtract.
//            So this function's only remaining job here is: if actual use
//            cost LESS than the full estimate, refund the difference — the
//            one direction PayHold's own mechanism cannot express.
//
//   hourly, split deal (payhold-create-deal set split_percent — every hourly
//            deal created before the full-upfront model, while the 50/50
//            split shipped) — the renter's OTHER 50% and any time beyond the
//            estimate were collected the same automatic way. Same shortfall
//            refund as the full-upfront case above; the only difference is
//            what was charged at booking, half instead of the whole
//            estimate. Kept for bookings already in flight when the split
//            was retired.
//
//   hourly, pre-overage deal (booked before either shipped, no split_percent
//            and no overage_rate on the deal) — the old behaviour, kept for
//            bookings already in flight: refund if actual use cost less than
//            the deposit, else record the shortfall in amount_owed_rwf
//            uncollected. Detected by re-reading the deal rather than a
//            booking-table flag, since the deal itself is the one thing that
//            cannot be migrated after the fact.
//
//   daily, overage-wired deal (payhold-create-deal set overage_rate — every
//            daily deal created after this comment was written) — no split,
//            the full amount was already charged up front exactly as
//            before. A return past the 2-hour grace is what PayHold's own
//            overage collection charges the penalty rate for, automatically,
//            at confirmation — on whichever payment method the renter used;
//            unlike hourly this is never certain to happen, so mobile money
//            stays offered at checkout for a daily booking (see PayHold's
//            METHOD_SUPPORTS_REUSE). If it cannot collect — no saved card —
//            the trip pauses the same way an hourly one would, and the host
//            claims the penalty from the renter themselves, physically,
//            outside PayHold, the way this always worked before automatic
//            collection existed at all. This function has nothing to add
//            either way. Daily bookings are never refunded for an early
//            return — a day rate, unlike an hourly one, was never metered.
//
//   daily, pre-overage-wiring deal (booked before this shipped, no
//            overage_rate on the deal) — the old behaviour, kept for
//            bookings already in flight: a return more than the 2-hour
//            grace past the agreed time (end_date + expected_return_time)
//            writes the overage to amount_owed_rwf, display-only, uncollected
//            by anything.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-settle-usage

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  DAILY_OVERAGE_GRACE_HOURS,
  getDeal,
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
        'id, renter_id, host_id, state, rental_type, end_date, expected_return_time, price_per_hour_rwf, overage_rate_rwf, deposit_amount_rwf, total_rwf, estimated_hours, charge_currency, payhold_deal_id, actual_hours, final_amount_rwf, amount_owed_rwf, amount_exceeded_rwf, pickup_renter_at, pickup_host_at, return_renter_at, return_host_at',
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
          amountExceededRwf: booking.amount_exceeded_rwf,
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

    // Which regime this deal was created under. Re-read from PayHold rather
    // than trusted from a booking-table flag: the deal itself is the one
    // thing already-in-flight bookings cannot be migrated to, so it is the
    // only honest source for "does this one auto-collect or not," for both
    // the hourly split and the daily overage below.
    const deal = booking.payhold_deal_id
      ? await getDeal(booking.payhold_deal_id as string).catch(() => null)
      : null;

    if (booking.rental_type === 'hourly') {
      const rate = Number(booking.price_per_hour_rwf ?? 0);
      const deposit = Number(booking.deposit_amount_rwf ?? 0);
      finalAmount = actualHours * rate;

      if (deal?.split_percent != null || deal?.overage_rate != null) {
        // Either shape PayHold auto-collects under — split (the deposit plus
        // overage) or full-upfront (just the overage) — leaves this function
        // the identical remaining job. PayHold has already collected
        // whatever was owed past what was charged at booking, automatically,
        // on the card the renter paid with — or the trip is paused pending
        // the host, if it could not (no saved card). Either way this
        // function has nothing to add UNLESS the trip ran short of the
        // estimate, which PayHold's mechanism cannot express in either
        // shape: it only ever collects more, never less, so an early return
        // means it collected more than was actually owed.
        const estimatedHours = Number(booking.estimated_hours ?? 0);
        const estimatedTotal = estimatedHours * rate;
        const overpaid = estimatedTotal - finalAmount; // positive: trip ran short

        if (overpaid > 0 && booking.payhold_deal_id) {
          const currency = (booking.charge_currency as string | null) ?? 'RWF';
          try {
            await refundDeal(
              booking.payhold_deal_id as string,
              'Hourly rental settled: actual time used came in under the booked estimate.',
              toMinorUnits(overpaid, currency),
            );
            refunded = overpaid;
          } catch (e) {
            const message = e instanceof PayHoldError ? e.message : String(e);
            console.error('payhold-settle-usage: refund failed', { bookingId, overpaid, message });
            return json(
              { error: `Could not refund the shortfall: ${message}`, code: 'refund_failed' },
              502,
            );
          }
        }
        // actualHours >= estimatedHours: nothing to do here. PayHold's own
        // automatic collection got exactly this, or is paused waiting on the
        // host — either way amount_owed_rwf is not this function's concern,
        // and is left at 0.
      } else {
        // Pre-overage-wiring deal: today's behaviour, unchanged, for a
        // booking created before hourly listings sent overage_rate at all.
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
            return json(
              { error: `Could not refund the deposit difference: ${message}`, code: 'refund_failed' },
              502,
            );
          }
        } else if (diff < 0) {
          amountOwed = -diff;
        }
      }
    } else if (deal?.overage_rate == null && booking.expected_return_time) {
      // Pre-overage-wiring deal: today's behaviour, unchanged, for a booking
      // created before payhold-create-deal started sending overage_rate for
      // daily listings. Naive, same as the rest of this schema — no
      // per-market timezone handling exists anywhere else in AutoHire
      // either. Postgres reads a `time` column back as "HH:MM:SS"; slice to
      // "HH:MM" so appending our own ":00Z" below can't double up on
      // seconds.
      const hhmm = String(booking.expected_return_time).slice(0, 5);
      const agreedReturnAt = new Date(`${booking.end_date}T${hhmm}:00Z`);
      const excessMs = returnAt.getTime() - agreedReturnAt.getTime();
      if (excessMs > DAILY_OVERAGE_GRACE_HOURS * 3_600_000) {
        const overageHours = Math.ceil(excessMs / 3_600_000);
        amountOwed = overageHours * Number(booking.overage_rate_rwf ?? 0);
      }
    }
    // A daily deal with overage_rate set: nothing to do here. PayHold's own
    // overage collection charges the penalty automatically at confirmation
    // if the return was late — the same grace period baked into
    // expected_complete_at at creation — or pauses the deal pending the
    // host if the renter paid by a method with no saved credential. Either
    // way amount_owed_rwf is not this function's concern for it, the same
    // reasoning as the hourly split case above.

    await admin
      .from('bookings')
      .update({
        actual_hours: actualHours,
        final_amount_rwf: finalAmount,
        amount_owed_rwf: amountOwed,
        // Fixed from this moment on — amount_owed_rwf is host-adjustable
        // afterward (migration 055), this isn't. "Exceeded by" and "still to
        // pay" are two different questions once a host starts resolving it.
        amount_exceeded_rwf: amountOwed,
      })
      .eq('id', bookingId);

    return json(
      { actualHours, finalAmountRwf: finalAmount, amountOwedRwf: amountOwed, amountExceededRwf: amountOwed, refundedRwf: refunded },
      200,
    );
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
