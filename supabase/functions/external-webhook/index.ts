// AutoHire — external-webhook Edge Function.
//
// The external payment system calls this when a hold changes state. An
// authorised hold becomes a booking; a voided/failed one leaves no trace.
// Mirrors `flutterwave-webhook`, with the same rules: the signature is verified
// before anything is read, the amount is recomputed from the listing (the
// payload's numbers are never trusted), and creation is idempotent on the hold
// reference so a retried delivery can't produce two trips.
//
// Secrets:  EXTERNAL_PAYMENTS_WEBHOOK_SECRET (+ EXTERNAL_PAYMENTS_* to re-read holds)
// Deploy:   supabase functions deploy external-webhook --no-verify-jwt
//           (no JWT: the caller is their server, not a signed-in user)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  externalWebhookConfigured,
  getHold,
  normaliseHold,
  verifyWebhookSignature,
} from '../_shared/external-payments.ts';

const SERVICE_FEE_RATE = 0.1;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    if (!externalWebhookConfigured()) {
      return json({ error: 'Webhook secret is not configured.' }, 503);
    }

    // Read the RAW body first — the signature covers the bytes, not the parse.
    const raw = await req.text();
    const signature =
      req.headers.get('x-signature') ??
      req.headers.get('x-webhook-signature') ??
      req.headers.get('verif-hash');
    if (!(await verifyWebhookSignature(raw, signature))) {
      return json({ error: 'Invalid signature.' }, 401);
    }

    const payload = JSON.parse(raw) as Record<string, unknown>;

    // Re-read the hold from the provider rather than trusting the delivery.
    const claimed = normaliseHold(payload.data ?? payload.hold ?? payload);
    const hold = await getHold(claimed.reference);
    if (hold.status !== 'authorised' && hold.status !== 'captured') {
      return json({ ignored: true, status: hold.status }, 200);
    }

    const meta = hold.metadata ?? {};
    const uid = meta.uid;
    const listingId = meta.listingId;
    const startDate = meta.startDate;
    const endDate = meta.endDate;
    if (!uid || !listingId || !startDate || !endDate) {
      return json({ error: 'Hold is missing booking metadata.' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Idempotency — one booking per hold reference.
    const existing = await admin
      .from('bookings')
      .select('id')
      .eq('payment_intent_id', hold.reference)
      .maybeSingle();
    if (existing.data) return json({ booking: existing.data.id, duplicate: true }, 200);

    // Hosts and companies are host-only — never turn their hold into a booking.
    const { data: renter } = await admin
      .from('profiles')
      .select('role, owner_type, verification')
      .eq('id', uid)
      .single();
    if (renter?.role === 'owner' || renter?.owner_type === 'business') {
      return json({ error: 'Host and company accounts cannot rent — they can only view cars.' }, 403);
    }
    if (renter?.verification !== 'verified') {
      return json({ error: 'Renter is not verified.' }, 403);
    }

    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('price_per_day_rwf, price_currency, host_id, booking_mode')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

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
        state: 'confirmed',
        subtotal_rwf: subtotal,
        service_fee_rwf: serviceFee,
        total_rwf: subtotal + serviceFee,
        payment_status: 'paid',
        provider: 'external',
        charge_currency: hold.currency || listing.price_currency || 'RWF',
        // The money is held, not taken — capture-payment releases it at pickup.
        hold_status: hold.status === 'captured' ? 'released' : 'held',
        payment_intent_id: hold.reference,
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
