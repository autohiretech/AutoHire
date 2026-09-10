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
//
// **A late return is charged automatically, on both rental types.** Every deal
// now carries `overage_rate`, so PayHold charges the renter's saved card for
// whatever the trip ran over the moment both sides confirm. Before this an
// hourly booking did that and a daily one only displayed the figure — the same
// late return either billed a card or asked the host to chase it, decided by
// how the car happened to be listed.
//
// So on a late return this function usually has nothing to record: PayHold has
// already taken it. `autoCollects` detects that by re-reading the deal, and
// leaves `amount_owed_rwf` alone rather than billing the renter twice — once
// on their card and once through their host.
//
// **When the charge cannot happen, the host is told the figure.** A renter who
// paid by mobile money has no reusable credential, so `chargeSaved` has no
// token; PayHold emits `order.balance_charge_failed` carrying the amount it
// could not take, and `payhold-webhook` writes that to the booking. The host
// then sees exactly what to collect in person. That is why mobile money stays
// offered at checkout: overage is conditional, and a trip that ends on time
// never needed a reusable credential at all.
//
// Two things still settle here, and neither is a surprise:
//
//   an early hourly return is REFUNDED — the renter paid for time they did
//            not use, and PayHold's overage cannot express that direction. A
//            daily booking is not refunded: a day rate was never metered,
//            which is why the meter cannot be run backwards on it.
//
//   a deal with NO overage terms — created before this, or for a listing with
//            no usable rate — settles the old way: the overage is written to
//            `amount_owed_rwf` for the host to act on, display not collection.
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

    // Deals created before the policy changed still carry `split_percent` or
    // `overage_rate`, and PayHold settles those itself at confirmation — the
    // instruction lives on the deal and cannot be migrated after the fact.
    // For them this function must not also record a debt, or the host would
    // chase money that has already been taken.
    const autoCollects = deal?.split_percent != null || deal?.overage_rate != null;

    if (booking.rental_type === 'hourly') {
      const rate = Number(booking.price_per_hour_rwf ?? 0);
      finalAmount = actualHours * rate;

      // What the renter has already paid for. `deposit_amount_rwf` on older
      // bookings; the booked estimate on every one since, because the deposit
      // was never a deposit — it was the full amount under another name, and
      // new deals no longer carry the label.
      const paidFor = Number(booking.deposit_amount_rwf ?? 0) ||
        Number(booking.estimated_hours ?? 0) * rate;
      const difference = paidFor - finalAmount; // positive: the trip ran short

      if (difference > 0 && booking.payhold_deal_id) {
        // Money back is the one direction that still moves on its own, and it
        // is not a surprise to anybody: the renter paid for time they did not
        // use. PayHold's own mechanism can never express it — overage only
        // ever adds — so the refund is this function's job in every regime.
        const currency = (booking.charge_currency as string | null) ?? 'RWF';
        try {
          await refundDeal(
            booking.payhold_deal_id as string,
            'Hourly rental settled: actual time used came in under what was paid for.',
            toMinorUnits(difference, currency),
          );
          refunded = difference;
        } catch (e) {
          // Don't write settlement numbers on a failed refund — leaving
          // actual_hours null keeps the idempotency guard above open, so a
          // retry can still attempt it rather than silently dropping it once
          // the booking looks "settled".
          const message = e instanceof PayHoldError ? e.message : String(e);
          console.error('payhold-settle-usage: refund failed', { bookingId, difference, message });
          return json(
            { error: `Could not refund the difference: ${message}`, code: 'refund_failed' },
            502,
          );
        }
      } else if (difference < 0 && !autoCollects) {
        amountOwed = -difference;
      }
    } else if (booking.expected_return_time && !autoCollects) {
      // Daily. Naive date handling, same as the rest of this schema — no
      // per-market timezone handling exists anywhere else in AutoHire either.
      // Postgres reads a `time` column back as "HH:MM:SS"; slice to "HH:MM" so
      // appending our own ":00Z" below cannot double up on seconds.
      const hhmm = String(booking.expected_return_time).slice(0, 5);
      const agreedReturnAt = new Date(`${booking.end_date}T${hhmm}:00Z`);
      const excessMs = returnAt.getTime() - agreedReturnAt.getTime();
      if (excessMs > DAILY_OVERAGE_GRACE_HOURS * 3_600_000) {
        const overageHours = Math.ceil(excessMs / 3_600_000);
        amountOwed = overageHours * Number(booking.overage_rate_rwf ?? 0);
      }
      // A day rate was never metered, so an early return is not refunded —
      // unlike hourly, where the meter is the whole basis of the price.
    }

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
