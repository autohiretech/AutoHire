// AutoHire — settle-cash Edge Function.
//
// The other end of `book-cash`: the host says what they were actually handed.
//
// It is asked rather than assumed, because the estimate is a guess about the
// future and this is a statement about the past. A trip comes back a day late,
// or a day early, or with the tank empty and something knocked off for it. The
// quote stays on the booking untouched and this lands beside it, so a trip
// where the two disagree still says what was agreed as well as what happened.
//
// Zero is a legal answer and means the renter never paid. That is a fact a host
// should be able to state in one tap rather than having to open a support
// thread to explain, and it is the fact most worth having in the record.
//
// Deploy:  supabase functions deploy settle-cash

import { createClient } from 'npm:@supabase/supabase-js@2';
import { payholdConfigured, settleCashDeal } from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
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
    const bookingId: string = body.bookingId;
    const collected: number = Number(body.collectedRwf);
    if (!bookingId) return json({ error: 'bookingId is required.' }, 400);
    if (!Number.isInteger(collected) || collected < 0) {
      return json({ error: 'collectedRwf must be zero or a whole number.' }, 400);
    }

    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .select('id, host_id, provider, payment_status, cash_collected_at, payhold_deal_id, total_rwf')
      .eq('id', bookingId)
      .single();
    if (bErr || !booking) return json({ error: 'Booking not found.' }, 404);

    // Only the host. The renter cannot certify what the host received, and an
    // admin correcting a figure is a different job with a different audit
    // trail — it does not come through the handoff screen.
    if (booking.host_id !== uid) {
      return json({ error: 'Only the host can record what they collected.' }, 403);
    }
    if (booking.provider !== 'cash') {
      return json(
        { error: 'This trip was paid through AutoHire — there is no cash to record.' },
        409,
      );
    }

    // Idempotent: a handoff screen tapped twice is one collection. Returning
    // the existing record beats both a duplicate and an error the host cannot
    // act on.
    if (booking.cash_collected_at) {
      return json({ booking: { id: booking.id, alreadyRecorded: true } }, 200);
    }

    const { error: upErr } = await admin
      .from('bookings')
      .update({
        cash_collected_rwf: collected,
        cash_collected_at: new Date().toISOString(),
        // Paid means money changed hands, which is exactly what the host has
        // just said. Nothing was collected, nothing is paid — and the booking
        // keeps saying so rather than being quietly closed as if it were fine.
        payment_status: collected > 0 ? 'paid' : 'unpaid',
      })
      .eq('id', bookingId);
    if (upErr) return json({ error: upErr.message }, 409);

    // PayHold's copy, best-effort for the same reason `book-cash` is: the money
    // is already in the host's hands and the booking already says so. A
    // bookkeeping call that failed must not read back as "your trip did not
    // close" — but the caller is told, so it is not guessing.
    let recorded: { settled?: boolean; error?: string } = {};
    if (payholdConfigured() && booking.payhold_deal_id) {
      try {
        await settleCashDeal(String(booking.payhold_deal_id), collected);
        recorded = { settled: true };
      } catch (e) {
        recorded = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    return json(
      {
        booking: { id: bookingId, cashCollectedRwf: collected, estimateRwf: booking.total_rwf },
        payhold: recorded,
      },
      200,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
