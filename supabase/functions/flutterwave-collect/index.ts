// AutoHire — flutterwave-collect Edge Function.
//
// Initiates a Flutterwave collection (card OR mobile money) for a car in an
// African market. The amount is computed SERVER-SIDE from the listing + dates
// (never trusted from the client), then Flutterwave Standard is used to create a
// hosted payment link the renter is redirected to. A webhook (flutterwave-webhook,
// to be added) confirms the charge, after which the booking is created via
// confirm-booking. The renter can be anywhere — a US card still works here,
// because the CAR is African, so Flutterwave is the single rail end-to-end.
//
// Modes, decided by whether FLUTTERWAVE_SECRET_KEY is set:
//   • Live  — creates a real Flutterwave payment and returns its hosted link.
//   • Demo  — returns a simulated success (no charge) so checkout still works.
//
// Secrets:  FLUTTERWAVE_SECRET_KEY, ALLOWED_ORIGIN, PUBLIC_APP_URL
// Deploy:   supabase functions deploy flutterwave-collect

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SERVICE_FEE_RATE = 0.1;
const FLW_KEY = Deno.env.get('FLUTTERWAVE_SECRET_KEY') ?? '';
const DEMO = !FLW_KEY;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
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
    const email = userData.user.email ?? 'renter@autohire.app';

    const { listingId, startDate, endDate } = await req.json();
    if (!listingId || !startDate || !endDate) {
      return json({ error: 'listingId, startDate and endDate are required.' }, 400);
    }

    // Renter eligibility mirrors the Stripe path: hosts and company accounts are
    // host-only (view but never book), and only verified renters may rent.
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
    if (profile?.verification !== 'verified') {
      return json({ error: 'Verify your identity before renting.', code: 'verification_required' }, 403);
    }

    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('price_per_day_rwf, price_currency, title, host_id')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

    const days = diffDays(startDate, endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const total = subtotal + Math.round(subtotal * SERVICE_FEE_RATE);
    const currency = String(listing.price_currency ?? 'RWF').toUpperCase();
    const txRef = `atrip-${uid.slice(0, 8)}-${Date.now()}`;

    if (DEMO) {
      // No charge — the client falls through to confirm-booking (demo mode).
      return json({ demo: true, txRef, amount: total, currency }, 200);
    }

    // Live: create a Flutterwave Standard payment and hand back its hosted link.
    const appUrl = Deno.env.get('PUBLIC_APP_URL') ?? '*';
    const res = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FLW_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: total,
        currency, // Flutterwave handles FX for foreign cards paying in RWF.
        redirect_url: `${appUrl}/cars/${listingId}/book?flw=${txRef}`,
        payment_options: 'card,mobilemoneyrwanda,mobilemoney',
        customer: { email },
        meta: { uid, listingId, startDate, endDate, totalRwf: String(total) },
        customizations: { title: 'AutoHire', description: listing.title },
      }),
    });
    const body = await res.json();
    if (!res.ok || body.status !== 'success') {
      return json({ error: body.message ?? 'Could not start the payment.' }, 502);
    }
    return json({ link: body.data.link, txRef, amount: total, currency }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
