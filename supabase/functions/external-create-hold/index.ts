// AutoHire — external-create-hold Edge Function.
//
// Opens the escrow hold on the external payment system, the way
// `create-payment-intent` does for the direct-Stripe rail. It computes the
// amount server-side (never trusts the client), refuses anyone who may not
// rent, and refuses dates that aren't actually free — so no hold is ever taken
// for a booking that can't happen.
//
// Returns whatever the browser needs to finish: a Stripe client secret (the
// external system settles through Stripe), a redirect URL, or neither if the
// hold is already authorised.
//
// Secrets:  EXTERNAL_PAYMENTS_* (see _shared/external-payments.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy external-create-hold

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHold, externalPaymentsConfigured } from '../_shared/external-payments.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
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

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!externalPaymentsConfigured()) {
      return json({ error: 'External payments are not configured.', code: 'not_configured' }, 503);
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

    const { listingId, startDate, endDate, returnUrl } = await req.json();
    if (!listingId || !startDate || !endDate) {
      return json({ error: 'listingId, startDate and endDate are required.' }, 400);
    }
    if (new Date(endDate) <= new Date(startDate)) {
      return json({ error: 'Return date must be after pick-up date.' }, 400);
    }

    // Same renter eligibility as every other rail: hosts and companies are
    // host-only, and only a verified identity may rent.
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
      .select('price_per_day_rwf, price_currency, title, host_id, blocked_dates')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

    // Don't hold money for dates that aren't available.
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
    const total = subtotal + Math.round(subtotal * SERVICE_FEE_RATE);

    // The hold is denominated in the car's own currency — the renter's market
    // never re-denominates it. Two-decimal currencies go out in minor units.
    // CONTRACT 5: if their API takes major units, drop the ×100 here.
    const currency = String(listing.price_currency ?? 'RWF').toUpperCase();
    const ZERO_DECIMAL = new Set(['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);
    const amount = ZERO_DECIMAL.has(currency) ? total : Math.round(total * 100);

    const hold = await createHold({
      amount,
      currency,
      description: `AutoHire — ${listing.title} (${days} day${days === 1 ? '' : 's'})`,
      metadata: {
        uid,
        listingId,
        startDate,
        endDate,
        totalRwf: String(total),
        priceCurrency: currency,
      },
      returnUrl,
    });

    return json(
      {
        reference: hold.reference,
        status: hold.status,
        clientSecret: hold.clientSecret,
        redirectUrl: hold.redirectUrl,
        amount,
        currency,
        totalRwf: total,
        priceCurrency: currency,
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
