// AutoHire — flutterwave-webhook Edge Function.
//
// Flutterwave calls this when a collection completes. We verify the webhook
// signature, re-verify the transaction with Flutterwave (never trust the payload
// alone), then create the booking server-side — recomputing the amount from the
// listing so a tampered webhook can't set its own price. Idempotent on tx_ref.
//
// This is the live counterpart to confirm-booking's demo path: for African-market
// cars the renter is redirected to Flutterwave, pays, and THIS creates the trip.
//
// Secrets:  FLUTTERWAVE_SECRET_KEY, FLUTTERWAVE_WEBHOOK_SECRET
// Deploy:   supabase functions deploy flutterwave-webhook --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

const SERVICE_FEE_RATE = 0.1;
const FLW_KEY = Deno.env.get('FLUTTERWAVE_SECRET_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('FLUTTERWAVE_WEBHOOK_SECRET') ?? '';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  // Verify the webhook came from Flutterwave.
  const sig = req.headers.get('verif-hash');
  if (!WEBHOOK_SECRET || sig !== WEBHOOK_SECRET) return json({ error: 'Invalid signature.' }, 401);

  try {
    const event = await req.json();
    if (event?.event !== 'charge.completed' || event?.data?.status !== 'successful') {
      return json({ ignored: true }, 200); // not a completed charge — nothing to do
    }

    const txId = event.data.id;
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Re-verify the transaction directly with Flutterwave.
    const verifyRes = await fetch(`https://api.flutterwave.com/v3/transactions/${txId}/verify`, {
      headers: { Authorization: `Bearer ${FLW_KEY}` },
    });
    const verify = await verifyRes.json();
    if (verify?.status !== 'success' || verify?.data?.status !== 'successful') {
      return json({ error: 'Transaction not verified.' }, 402);
    }

    const tx = verify.data;
    const txRef = tx.tx_ref as string;
    const meta = tx.meta ?? {};
    const uid = meta.uid as string;
    const listingId = meta.listingId as string;
    const startDate = meta.startDate as string;
    const endDate = meta.endDate as string;
    if (!uid || !listingId || !startDate || !endDate) {
      return json({ error: 'Transaction missing booking metadata.' }, 400);
    }

    // Idempotency — one booking per tx_ref.
    const existing = await admin.from('bookings').select('id').eq('payment_intent_id', txRef).maybeSingle();
    if (existing.data) return json({ booking: existing.data.id, duplicate: true }, 200);

    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('price_per_day_rwf, price_currency, host_id, booking_mode')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);

    const days = diffDays(startDate, endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);

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
        provider: 'flutterwave',
        charge_currency: (tx.currency as string) ?? listing.price_currency ?? 'RWF',
        hold_status: 'held',
        payment_intent_id: txRef,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insErr) return json({ error: insErr.message }, 409);

    return json({ booking: row.id }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
