// AutoHire — create-payment-intent Edge Function (Stripe card collection).
//
// Computes the booking amount server-side (never trusts the client) and creates
// a Stripe PaymentIntent, returning its client secret for the browser to
// confirm with Stripe Elements.
//
// Secrets (set in the dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   STRIPE_SECRET_KEY   — your Stripe secret key (sk_test_… to start)
//   RWF_PER_USD         — optional FX rate (default 1300); foreigners are charged in USD
//
// Deploy:  supabase functions deploy create-payment-intent --no-verify-jwt

import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SERVICE_FEE_RATE = 0.1;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2024-06-20',
});

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!Deno.env.get('STRIPE_SECRET_KEY')) {
      return json({ error: 'Stripe is not configured (missing STRIPE_SECRET_KEY).' }, 400);
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

    const { listingId, startDate, endDate } = await req.json();
    if (!listingId || !startDate || !endDate) {
      return json({ error: 'listingId, startDate and endDate are required.' }, 400);
    }
    if (new Date(endDate) <= new Date(startDate)) {
      return json({ error: 'Return date must be after pick-up date.' }, 400);
    }

    // Business/company accounts are hosts only — they may not rent.
    const { data: profile } = await admin
      .from('profiles')
      .select('owner_type')
      .eq('id', uid)
      .single();
    if (profile?.owner_type === 'business') {
      return json({ error: 'Business accounts cannot rent.' }, 403);
    }

    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('price_per_day_rwf, title, host_id, blocked_dates')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

    // Don't take money for dates that aren't actually available.
    const blocked = new Set<string>((listing.blocked_dates as string[] | null) ?? []);
    for (let d = new Date(startDate); d < new Date(endDate); d.setDate(d.getDate() + 1)) {
      if (blocked.has(d.toISOString().slice(0, 10))) {
        return json({ error: 'Those dates are not available for this car.' }, 409);
      }
    }
    const { data: clash } = await admin
      .from('bookings')
      .select('id')
      .eq('listing_id', listingId)
      .not('state', 'in', '(cancelled,declined,completed)')
      .lt('start_date', endDate)
      .gt('end_date', startDate)
      .maybeSingle();
    if (clash) return json({ error: 'This car is already booked for those dates.' }, 409);

    const days = diffDays(startDate, endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const totalRwf = subtotal + Math.round(subtotal * SERVICE_FEE_RATE);

    // Foreigners are charged in USD; convert from RWF. Stripe USD is in cents.
    const rwfPerUsd = Number(Deno.env.get('RWF_PER_USD') ?? '1300');
    const amountUsdCents = Math.max(50, Math.round((totalRwf / rwfPerUsd) * 100));

    const intent = await stripe.paymentIntents.create({
      amount: amountUsdCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { uid, listingId, startDate, endDate, totalRwf: String(totalRwf) },
      description: `AutoHire — ${listing.title} (${days} day${days === 1 ? '' : 's'})`,
    });

    return json(
      { clientSecret: intent.client_secret, amountUsdCents, currency: 'usd', totalRwf },
      200,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
