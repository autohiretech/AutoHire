// AutoHire — payhold-dispute Edge Function.
//
// Opens a case in PayHold's Resolution Center and mirrors it into AutoHire's
// `disputes` table, in that order.
//
// Until this existed, disputes were ONE-WAY: a case opened in PayHold arrived
// here by webhook, but a dispute raised in AutoHire stayed in AutoHire. That
// gap had teeth — opening a case in PayHold is what FREEZES the payout on that
// deal. A renter reporting damage in the app while the host's money quietly
// cleared and went out is the failure this closes.
//
// Order matters and is deliberate. PayHold is called FIRST: if it refuses, no
// local row is written, so AutoHire never shows a dispute that is not freezing
// anything. If PayHold accepts and our write then fails, the case still exists
// on their side and the `dispute.opened` webhook mirrors it in — the loss is a
// slightly worse `raised_by`, not a missed freeze.
//
// Which side raised it comes from the SESSION, never the request. A renter who
// could pass raised_by=seller would file against themselves.
//
//   GET  /payhold-dispute   every dispute this person is party to
//   POST /payhold-dispute   { bookingId, reason, reasonCode?, amount? }
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-dispute

import { createClient } from 'npm:@supabase/supabase-js@2';
import { openDispute, payholdConfigured, toMinorUnits } from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** A case cannot be opened once the money is gone — say which, so the person knows. */
const TOO_LATE: Record<string, string> = {
  paid_out: 'This payout has already been sent, so there is nothing left to hold.',
  refunded: 'This booking was already refunded in full.',
  canceled: 'This booking was cancelled, so no money moved.',
  expired: 'This booking expired before it was paid.',
  payment_failed: 'This booking was never paid for.',
};

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

    // ---------------------------------------------------------------------
    // GET — the cases this person is party to
    // ---------------------------------------------------------------------
    //
    // Both sides, in one list. A host wants the cases filed against them and
    // the ones they filed; splitting those into two calls would only make the
    // screen ask twice. Admins see everything, which is what /admin already
    // reads today — this route exists so a *party* can see their own without
    // going through an admin.
    if (req.method === 'GET') {
      const { data: caller } = await admin
        .from('profiles')
        .select('role')
        .eq('id', uid)
        .single();

      let q = admin
        .from('disputes')
        .select('id, booking_id, raised_by, against, reason, amount_rwf, created_at, status, payhold_dispute_id')
        .order('created_at', { ascending: false })
        .limit(100);

      if (caller?.role !== 'admin') q = q.or(`raised_by.eq.${uid},against.eq.${uid}`);

      const { data: rows, error } = await q;
      if (error) return json({ error: error.message }, 500);

      return json(
        {
          disputes: (rows ?? []).map((d) => ({
            id: d.id,
            bookingId: d.booking_id,
            raisedBy: d.raised_by,
            against: d.against,
            reason: d.reason,
            amountRwf: d.amount_rwf,
            createdAt: d.created_at,
            status: d.status,
            // Null means this case is local-only and is NOT freezing a payout —
            // an older dispute, or one raised before PayHold was switched on.
            payholdDisputeId: d.payhold_dispute_id ?? null,
          })),
        },
        200,
      );
    }

    if (req.method !== 'POST') return json({ error: 'GET or POST only.' }, 405);

    // ---------------------------------------------------------------------
    // POST — open one
    // ---------------------------------------------------------------------

    const body = await req.json().catch(() => ({}));
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode : 'other';
    const amount = typeof body.amount === 'number' && body.amount > 0 ? body.amount : undefined;

    if (!bookingId) return json({ error: 'bookingId is required.' }, 400);
    if (reason.length < 10) {
      // A one-word reason is a case an operator cannot decide, and they will
      // come back and ask — better to ask now, while the person is still here.
      return json({ error: 'Say what happened, in a sentence or more.' }, 400);
    }

    const { data: booking } = await admin
      .from('bookings')
      .select('id, renter_id, host_id, total_rwf, charge_currency, payhold_deal_id, state')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return json({ error: 'Booking not found.' }, 404);

    const side =
      uid === booking.renter_id ? 'buyer' : uid === booking.host_id ? 'seller' : null;
    if (!side) return json({ error: 'You are not part of this booking.' }, 403);

    if (!booking.payhold_deal_id) {
      // Nothing to freeze. Rather than open a PayHold case against a deal that
      // does not exist, say so — this booking was paid on an older rail and its
      // dispute is an AutoHire-only matter for now.
      return json(
        {
          error: 'This booking was not paid through PayHold, so a case cannot be opened there.',
          code: 'no_deal',
        },
        409,
      );
    }

    const currency = (booking.charge_currency as string | null) ?? 'RWF';
    const against = side === 'buyer' ? booking.host_id : booking.renter_id;

    // One open case per booking — the same rule the webhook's mirror follows.
    // A second case against one deal would give an operator two half-records of
    // the same argument and no way to tell which freeze is the live one.
    const { data: existing } = await admin
      .from('disputes')
      .select('id, status, payhold_dispute_id')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (existing && ['open', 'under_review'].includes(existing.status as string)) {
      return json(
        {
          error: 'A case is already open on this booking.',
          code: 'already_open',
          disputeId: existing.id,
          payholdDisputeId: existing.payhold_dispute_id ?? null,
        },
        409,
      );
    }

    // PayHold first. A refusal here — deal already paid out, already disputed —
    // must leave AutoHire unchanged.
    let payholdDisputeId: string | null = null;
    if (payholdConfigured()) {
      try {
        const opened = await openDispute({
          dealId: booking.payhold_deal_id as string,
          raisedBy: side,
          reason,
          reasonCode,
          // PayHold takes minor units in the deal's currency. Omitted means the
          // whole deal is in dispute, which is the common case and is not the
          // same as disputing zero.
          disputedAmount: amount === undefined ? undefined : toMinorUnits(amount, currency),
        });
        payholdDisputeId = opened.id;
      } catch (e) {
        const status = (e as { status?: number }).status ?? 502;
        const message = e instanceof Error ? e.message : String(e);
        const friendly = Object.entries(TOO_LATE).find(([s]) => message.includes(s))?.[1];
        return json({ error: friendly ?? message, code: 'payhold_refused' }, status);
      }
    }

    const amountRwf = Math.round(amount ?? (booking.total_rwf as number) ?? 0);
    const now = new Date().toISOString();

    // Re-read: the `dispute.opened` webhook may have landed while we waited on
    // the call above and mirrored the case already. If it did, its row has the
    // renter as raiser by default — correct it to who actually filed.
    const { data: raced } = await admin
      .from('disputes')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (raced) {
      const { error: upErr } = await admin
        .from('disputes')
        .update({
          raised_by: uid,
          against,
          reason,
          amount_rwf: amountRwf,
          status: 'open',
          // Only when we have one. PayHold being unconfigured must not erase an
          // id the webhook already wrote — that id is the freeze.
          ...(payholdDisputeId ? { payhold_dispute_id: payholdDisputeId } : {}),
        })
        .eq('id', raced.id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json(
        { disputeId: raced.id, payholdDisputeId, frozen: !!payholdDisputeId, status: 'open', side },
        200,
      );
    }

    const id = `dsp-${Date.now()}`;
    const { error: insErr } = await admin.from('disputes').insert({
      id,
      booking_id: bookingId,
      raised_by: uid,
      against,
      reason,
      amount_rwf: amountRwf,
      created_at: now,
      status: 'open',
      payhold_dispute_id: payholdDisputeId,
    });

    if (insErr) {
      // The case IS open in PayHold and the payout IS frozen. Loud, because the
      // freeze is now invisible in AutoHire until the webhook mirrors it.
      console.error('payhold dispute opened but not mirrored locally', {
        bookingId,
        payholdDisputeId,
        error: insErr.message,
      });
      return json({ error: insErr.message, payholdDisputeId }, 500);
    }

    // `frozen` is the field that matters and the reason it is returned
    // separately from the id: a case with no PayHold id behind it is a
    // complaint, not a hold, and a screen that says "the money is safe" when
    // nothing is holding it is worse than one that says nothing.
    return json({ disputeId: id, payholdDisputeId, frozen: !!payholdDisputeId, status: 'open', side }, 200);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
