// AutoHire — payhold-webhook Edge Function.
//
// Where PayHold's money events become AutoHire's trips. This is the only path
// that creates a paid booking: the renter pays on PayHold's hosted page and
// never returns through a route we control, so the browser cannot be the thing
// that tells us a payment happened.
//
// Two rules hold everything up:
//
//   1. The payload is NOT trusted. It is used for one thing — which deal to go
//      and look at — and every particular of the booking is read from the deal
//      itself via GET /deals/:id. A forged payload therefore buys nothing.
//   2. Delivery is idempotent on the deal id. PayHold retries at 1m, 5m, 30m
//      and 2h; a redelivery must find the booking it already made.
//
// Deploy with --no-verify-jwt: the caller is PayHold's server, not a signed-in
// user. The signature IS the authentication.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts)
// Deploy:   supabase functions deploy payhold-webhook --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  getDeal,
  payholdConfigured,
  payholdWebhookConfigured,
  verifyWebhookSignature,
  type Deal,
  type WebhookEvent,
} from '../_shared/payhold.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create the trip a funded deal paid for.
 *
 * Every value comes from the deal's own metadata, which PayHold returned to us
 * — not from the webhook body. The unique index on `payhold_deal_id` is the
 * real idempotency guard; the pre-check just avoids the noisy insert.
 */
async function createBooking(admin: SupabaseClient, deal: Deal): Promise<Response> {
  const existing = await admin
    .from('bookings')
    .select('id')
    .eq('payhold_deal_id', deal.id)
    .maybeSingle();
  if (existing.data) return json({ booking: existing.data.id, duplicate: true }, 200);

  const { uid, listingId, startDate, endDate } = deal.metadata ?? {};
  if (!uid || !listingId || !startDate || !endDate) {
    // A funded deal we cannot place. Loud, because the money is real and
    // somebody has to reconcile it by hand.
    console.error('payhold deal funded without booking metadata', { deal: deal.id });
    return json({ error: 'Deal has no booking metadata.' }, 422);
  }

  // The same eligibility the checkout enforced, re-checked at the moment the
  // booking is actually written. A role can change between paying and funding.
  const { data: renter } = await admin
    .from('profiles')
    .select('role, owner_type, verification')
    .eq('id', uid)
    .single();
  if (renter?.role === 'owner' || renter?.owner_type === 'business') {
    return json({ error: 'Host and company accounts cannot rent.' }, 403);
  }
  if (renter?.verification !== 'verified') {
    return json({ error: 'Renter is not verified.' }, 403);
  }

  const { data: listing, error: listErr } = await admin
    .from('listings')
    .select('host_id, booking_mode, price_currency')
    .eq('id', listingId)
    .single();
  if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);

  // Recomputed from the metadata we wrote at creation rather than re-derived
  // from today's listing price — a host who raised their rate mid-checkout must
  // not change what the renter already agreed to and paid.
  const days = Number(deal.metadata.days ?? 0);
  const subtotal = Number(deal.metadata.subtotal ?? 0);
  const serviceFee = Number(deal.metadata.serviceFee ?? 0);
  const total = Number(deal.metadata.total ?? 0);

  const { data: inserted, error: insErr } = await admin
    .from('bookings')
    .insert({
      id: `bk-${Date.now()}`,
      listing_id: listingId,
      renter_id: uid,
      host_id: listing.host_id,
      start_date: startDate,
      end_date: endDate,
      days,
      state: 'confirmed',
      subtotal_rwf: subtotal,
      service_fee_rwf: serviceFee,
      total_rwf: total,
      payment_status: 'paid',
      provider: 'payhold',
      charge_currency: deal.currency || listing.price_currency || 'RWF',
      // PayHold holds it. It is released when both sides confirm, not by us.
      hold_status: 'held',
      payhold_deal_id: deal.id,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insErr) {
    // A concurrent delivery won the race — the unique index did its job.
    const raced = await admin
      .from('bookings')
      .select('id')
      .eq('payhold_deal_id', deal.id)
      .maybeSingle();
    if (raced.data) return json({ booking: raced.data.id, duplicate: true }, 200);
    return json({ error: insErr.message }, 409);
  }

  // Deliberately NOT auto-confirmed. This used to call confirmDeal('buyer')
  // and confirmDeal('seller') immediately here, which released the hold to
  // the host within a second of the booking existing — before the renter had
  // picked up the car, on a rental of any length. Confirmation is now the
  // renter's and host's own return-handoff confirm in the app (see
  // confirmHandoff() / payhold-confirm), which is the only thing that should
  // be able to tell PayHold a trip actually happened. PayHold's own
  // auto-release timer (`auto_release_days`) is what protects a host whose
  // renter never confirms anything — this function does not need to race it.
  return json({ booking: inserted.id }, 200);
}

/** Find the booking a deal paid for, if the trip exists yet. */
async function bookingFor(admin: SupabaseClient, dealId: string) {
  const { data } = await admin
    .from('bookings')
    .select('id, state, host_id, renter_id, total_rwf')
    .eq('payhold_deal_id', dealId)
    .maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  try {
    if (!payholdConfigured() || !payholdWebhookConfigured()) {
      return json({ error: 'PayHold is not configured.' }, 503);
    }

    // Read the body as text before parsing — the signature is over the exact
    // bytes sent, and a re-serialized object is not those bytes.
    const raw = await req.text();
    const signature = req.headers.get('PayHold-Signature');

    if (!(await verifyWebhookSignature(raw, signature))) {
      // Deliberately terse. A caller who cannot sign does not get told whether
      // it was the secret, the timestamp or the digest that was wrong.
      return json({ error: 'Invalid signature.' }, 401);
    }

    const event = JSON.parse(raw) as WebhookEvent;
    if (!event?.deal_id) return json({ received: true, ignored: 'no deal id' }, 200);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // The trust boundary. The event told us where to look; PayHold tells us
    // what is true.
    const deal = await getDeal(event.deal_id);

    switch (event.event) {
      // The money is held. This is the only event that creates a trip.
      case 'order.funded_held':
        return await createBooking(admin, deal);

      // Both sides confirmed: the hold is released into the host's wallet and
      // the clearance clock has started. The balance the host sees comes from
      // PayHold directly, so there is nothing to copy — but the trip is done
      // paying and `hold_status` should stop claiming otherwise.
      case 'order.clearing_started':
      case 'order.released': {
        const booking = await bookingFor(admin, deal.id);
        if (booking) {
          await admin
            .from('bookings')
            .update({ hold_status: 'released' })
            .eq('id', booking.id);
        }
        return json({ received: true, booking: booking?.id ?? null }, 200);
      }

      // The host has actually been paid. Recorded on the payout row so the
      // earnings screen can show it without asking PayHold every render.
      case 'payout.paid': {
        const booking = await bookingFor(admin, deal.id);
        if (booking) {
          await admin
            .from('payouts')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('booking_id', booking.id);
        }
        return json({ received: true, booking: booking?.id ?? null }, 200);
      }

      // Money went back to the renter — all of it, or some of it.
      //
      // The event does not say which; the DEAL does. `payhold-refund` can send
      // a partial refund (a damaged-return settlement, a late-cancellation
      // fee), and cancelling the trip for one would take the car back off a
      // renter who is still driving it. The deal's own status is the only thing
      // that distinguishes the two, which is why this branches on it rather
      // than on the event name.
      case 'refund.succeeded': {
        const booking = await bookingFor(admin, deal.id);
        if (booking) {
          if (deal.status === 'partially_refunded') {
            await admin
              .from('bookings')
              .update({ payment_status: 'partially_refunded' })
              .eq('id', booking.id);
          } else if (booking.state !== 'cancelled') {
            await admin
              .from('bookings')
              .update({ state: 'cancelled', payment_status: 'refunded', hold_status: 'released' })
              .eq('id', booking.id);
          }
        }
        return json({ received: true, booking: booking?.id ?? null, dealStatus: deal.status }, 200);
      }

      // A case was opened in PayHold's Resolution Center — by either side, or
      // by an operator there. Payouts on this deal are frozen on their side;
      // mirroring it here is what makes it visible in AutoHire.
      case 'dispute.opened': {
        const booking = await bookingFor(admin, deal.id);
        if (booking) {
          const existing = await admin
            .from('disputes')
            .select('id')
            .eq('booking_id', booking.id)
            .maybeSingle();
          if (!existing.data) {
            await admin.from('disputes').insert({
              id: `dsp-${Date.now()}`,
              booking_id: booking.id,
              raised_by: booking.renter_id,
              against: booking.host_id,
              reason: String(event.data?.reason ?? 'Opened in PayHold'),
              amount_rwf: booking.total_rwf,
              created_at: new Date().toISOString(),
              status: 'open',
              payhold_dispute_id: String(event.data?.dispute_id ?? ''),
            });
          }
        }
        return json({ received: true, booking: booking?.id ?? null }, 200);
      }

      // Everything else is observable on PayHold's side and changes nothing
      // here: payment.failed and order.expired happen before a booking exists,
      // payout.pending is a step we don't render. Acknowledged so PayHold stops
      // retrying — a 200 means "received", not "acted on".
      default:
        return json({ received: true, ignored: event.event }, 200);
    }
  } catch (e) {
    // A non-2xx tells PayHold to retry, which is what we want for a transient
    // failure — their five attempts span two hours.
    console.error('payhold webhook failed', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
