// AutoHire — capture-payment Edge Function.
//
// Releases the escrow HOLD. When a booking is paid we only AUTHORISE the card
// (capture_method: 'manual'); this captures that authorisation when the trip
// actually starts (pickup), turning the hold into a real charge.
//
// Which rail does the capture depends on the booking's provider:
//   • 'external'    — the external hold system captures it (its own API),
//   • 'stripe'      — we capture the PaymentIntent directly,
//   • 'flutterwave' — nothing to capture; the money is already collected and
//                     held in the platform balance, released at completion.
//
// Call this on the trip's pickup/active transition (from the app or a worker).
// Idempotent: a booking already 'released' returns success.
//
// Secrets:  STRIPE_SECRET_KEY, ALLOWED_ORIGIN
// Deploy:   supabase functions deploy capture-payment

import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureHold, externalPaymentsConfigured } from '../_shared/external-payments.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
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

    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select('renter_id, host_id, provider, hold_status, payment_intent_id')
      .eq('id', bookingId)
      .single();
    if (bErr || !booking) return json({ error: 'Booking not found.' }, 404);

    // Only a participant (or admin) can trigger capture.
    const { data: caller } = await admin.from('profiles').select('role').eq('id', uid).single();
    const isParticipant = uid === booking.renter_id || uid === booking.host_id || caller?.role === 'admin';
    if (!isParticipant) return json({ error: 'Not allowed.' }, 403);

    if (booking.hold_status === 'released') return json({ released: true, already: true }, 200);

    // External hold system: it owns the authorisation, so it does the capture.
    if (booking.provider === 'external') {
      if (!externalPaymentsConfigured()) {
        return json({ error: 'External payments are not configured.', code: 'not_configured' }, 503);
      }
      const hold = await captureHold(booking.payment_intent_id as string);
      if (hold.status !== 'captured') {
        return json({ error: `Hold could not be captured (status: ${hold.status}).` }, 402);
      }
      await admin.from('bookings').update({ hold_status: 'released' }).eq('id', bookingId);
      return json({ released: true, provider: 'external' }, 200);
    }

    // Flutterwave: nothing to capture — funds are already in the platform balance.
    if (booking.provider !== 'stripe' || !STRIPE_KEY) {
      await admin.from('bookings').update({ hold_status: 'released' }).eq('id', bookingId);
      return json({ released: true, provider: booking.provider ?? 'demo' }, 200);
    }

    const stripe = new Stripe(STRIPE_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: '2024-06-20',
    });
    const intent = await stripe.paymentIntents.retrieve(booking.payment_intent_id as string);
    if (intent.status === 'requires_capture') {
      await stripe.paymentIntents.capture(intent.id);
    }
    await admin.from('bookings').update({ hold_status: 'released' }).eq('id', bookingId);
    return json({ released: true, provider: 'stripe' }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
