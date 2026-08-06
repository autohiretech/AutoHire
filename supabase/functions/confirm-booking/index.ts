// AutoHire — confirm-booking Edge Function.
//
// The ONLY path that creates a booking row, so a booking can never exist
// without going through the server (amounts are recomputed here, availability
// and the status state-machine are enforced by DB triggers).
//
// Two modes, decided by whether STRIPE_SECRET_KEY is set:
//
//   • Live mode (STRIPE_SECRET_KEY present): re-fetches the Stripe
//     PaymentIntent, requires status === 'succeeded' and metadata matching the
//     caller / listing / dates. A paid booking can't be forged.
//
//   • Demo mode (no STRIPE_SECRET_KEY): NO real charge. Clicking "Pay" confirms
//     the booking instantly using the listing + dates from the request. The
//     server still owns the price and availability, so the demo can't be abused
//     to set its own amount — it just skips collecting money. Needs no secrets
//     (Supabase injects SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY automatically).
//
// Deploy:  supabase functions deploy confirm-booking

import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { externalPaymentsConfigured, getHold } from '../_shared/external-payments.ts';

const cors = {
  // Set the ALLOWED_ORIGIN secret to your web app's origin in production.
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SERVICE_FEE_RATE = 0.1;
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const EXTERNAL = externalPaymentsConfigured(); // external hold system connected?
const DEMO = !STRIPE_KEY && !EXTERNAL; // nothing configured → demo checkout.

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

/** snake_case DB row -> camelCase, matching the app's data client mapper. */
function toCamelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
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

    const body = await req.json();

    // Resolve the booking details + a payment reference, per mode.
    let listingId: string;
    let startDate: string;
    let endDate: string;
    let paymentRef: string;
    let provider: 'stripe' | 'flutterwave' | 'external' | null = null;
    let held = true;

    if (EXTERNAL) {
      // External hold system: re-read the hold from the provider — the browser
      // only ever hands us a reference, never a status.
      const reference = body.reference ?? body.paymentIntentId;
      if (!reference) return json({ error: 'reference is required.' }, 400);

      const existing = await admin
        .from('bookings')
        .select('*')
        .eq('payment_intent_id', reference)
        .maybeSingle();
      if (existing.data) return json({ booking: toCamelRow(existing.data) }, 200);

      const hold = await getHold(reference);
      if (hold.status !== 'authorised' && hold.status !== 'captured') {
        return json({ error: 'Payment has not been authorised.', status: hold.status }, 402);
      }
      const m = hold.metadata ?? {};
      if (m.uid !== uid) return json({ error: 'This payment does not belong to you.' }, 403);
      if (!m.listingId || !m.startDate || !m.endDate) {
        return json({ error: 'Payment is missing booking details.' }, 400);
      }
      listingId = m.listingId;
      startDate = m.startDate;
      endDate = m.endDate;
      paymentRef = hold.reference;
      provider = 'external';
      held = hold.status !== 'captured';
    } else if (DEMO) {
      // Demo: trust the listing + dates from the request (price is still
      // recomputed below from the listing; availability is enforced by triggers).
      listingId = body.listingId;
      startDate = body.startDate;
      endDate = body.endDate;
      if (!listingId || !startDate || !endDate) {
        return json({ error: 'listingId, startDate and endDate are required.' }, 400);
      }
      paymentRef = `demo-${crypto.randomUUID()}`;
    } else {
      // Live: the payment must actually have succeeded and belong to this user.
      const paymentIntentId = body.paymentIntentId;
      if (!paymentIntentId) return json({ error: 'paymentIntentId is required.' }, 400);

      // Idempotency — if this payment already produced a booking, return it.
      const existing = await admin
        .from('bookings')
        .select('*')
        .eq('payment_intent_id', paymentIntentId)
        .maybeSingle();
      if (existing.data) return json({ booking: toCamelRow(existing.data) }, 200);

      const stripe = new Stripe(STRIPE_KEY, {
        httpClient: Stripe.createFetchHttpClient(),
        apiVersion: '2024-06-20',
      });
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      // With manual capture the money is authorised & held ('requires_capture')
      // until the trip starts; 'succeeded' means already captured. Both are valid.
      if (intent.status !== 'requires_capture' && intent.status !== 'succeeded') {
        return json({ error: 'Payment has not been authorised.' }, 402);
      }
      const m = intent.metadata ?? {};
      if (m.uid !== uid) return json({ error: 'This payment does not belong to you.' }, 403);
      if (!m.listingId || !m.startDate || !m.endDate) {
        return json({ error: 'Payment is missing booking details.' }, 400);
      }
      listingId = m.listingId;
      startDate = m.startDate;
      endDate = m.endDate;
      paymentRef = paymentIntentId;
    }

    // --- Shared: validate the renter + recompute amounts server-side. --------

    // Hosts (role 'owner') and company accounts are host-only — they may browse
    // and view listings but never book one. The booking_renter_guard trigger
    // enforces this again on the insert below, for every creation path.
    const { data: profile } = await admin
      .from('profiles')
      .select('role, owner_type, verification')
      .eq('id', uid)
      .single();
    if (profile?.owner_type === 'business') {
      return json({ error: 'Company accounts cannot rent — they can only view cars.' }, 403);
    }
    if (profile?.role === 'owner') {
      return json({ error: 'Host accounts cannot rent — they can only view cars.' }, 403);
    }
    // Renters must have a verified identity before they can rent. This is the
    // authoritative gate — the UI blocks earlier, but a booking can never be
    // created for an unverified renter regardless of how confirm is called.
    if (profile?.verification !== 'verified') {
      return json({ error: 'Verify your identity before renting.', code: 'verification_required' }, 403);
    }

    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('price_per_day_rwf, price_currency, country, host_id, booking_mode')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

    // With the external hold system connected it handles every market, so the
    // rail is already decided above. Otherwise route by the CAR's market:
    // Flutterwave for African markets (money lands as local currency / MoMo),
    // Stripe otherwise.
    if (!provider) {
      const AFRICA = new Set(['RW', 'KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'CI']);
      provider = AFRICA.has(String(listing.country ?? 'RW').toUpperCase()) ? 'flutterwave' : 'stripe';
    }

    const days = diffDays(startDate, endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);

    // Create the booking. DB triggers enforce availability + immutability.
    const { data: row, error: insErr } = await admin
      .from('bookings')
      .insert({
        id: `bk-${Date.now()}`,
        listing_id: listingId,
        renter_id: uid,
        host_id: listing.host_id,
        start_date: startDate,
        end_date: endDate,
        days,
        state: listing.booking_mode === 'instant' ? 'confirmed' : 'requested',
        subtotal_rwf: subtotal,
        service_fee_rwf: serviceFee,
        total_rwf: subtotal + serviceFee,
        payment_status: 'paid',
        provider,
        charge_currency: listing.price_currency ?? 'RWF',
        hold_status: held ? 'held' : 'released',
        payment_intent_id: paymentRef,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insErr) return json({ error: insErr.message }, 409);

    return json({ booking: toCamelRow(row), demo: DEMO }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
