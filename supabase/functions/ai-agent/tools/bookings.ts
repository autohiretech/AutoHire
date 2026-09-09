// AutoHire — ai-agent booking tools.
//
// `start_booking` and `cancel_trip` are the two `money`/`destructive` tools
// in this registry — loop.ts never calls their `run()` on the request that
// first asks for them; it signs a confirm token and stops. `run()` itself is
// identical either way (it doesn't know or care that it was gated) — mirrors
// createPayholdDeal / cancelBooking in web/src/lib/supabaseClient.ts,
// invoking the same Edge Functions with the caller's own JWT.
//
// respond_to_booking and confirm_handoff are plain `write` — they don't move
// money themselves (PayHold's own hold/release machinery does that once both
// sides have confirmed a return), so they execute immediately like any other
// write tool.

import type { ToolDef } from './types.ts';
import { mapRow, run } from './db.ts';

export const startBookingTool: ToolDef<
  {
    listingId: string;
    startDate: string;
    endDate: string;
    pickupTime?: string;
    rentalType: 'daily' | 'hourly';
    estimatedHours?: number;
  },
  { dealId: string; paymentLink: string; status: string; total: number; action: { type: 'navigate'; route: string } }
> = {
  name: 'start_booking',
  description:
    'Start booking a specific car — call once the car, the dates, and (for an hourly car) the estimated ' +
    'hours are known. Pickup time is optional: do NOT ask for one, and do not hold up a booking waiting for ' +
    'it — pass it only if the renter actually named a time. Opens a PayHold checkout link; nothing is ' +
    'charged until the user pays there.',
  input_schema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      startDate: { type: 'string', description: 'ISO date.' },
      endDate: { type: 'string', description: 'ISO date, after startDate.' },
      pickupTime: { type: 'string', description: 'Optional. 24-hour HH:mm, only if the renter named a time.' },
      rentalType: { type: 'string', enum: ['daily', 'hourly'] },
      estimatedHours: { type: 'number', description: 'Required when rentalType is hourly.' },
    },
    // `pickupTime` is deliberately NOT required: `Booking.pickupTime` is
    // `string | null` in the app's own shared types, so a booking without one
    // is valid. Having it here made the agent stop and ask "what time?" on
    // every booking — demanding something the product never required.
    required: ['listingId', 'startDate', 'endDate', 'rentalType'],
  },
  scope: 'renter',
  effect: 'money',
  summary: (input) => `Starting checkout for ${input.listingId}`,
  async run(ctx, input) {
    const { data, error } = await ctx.supabase.functions.invoke('payhold-create-deal', { body: input });
    if (error) throw new Error(`Could not start the payment: ${error.message}`);
    const payload = data as { dealId?: string; paymentLink?: string; status?: string; total?: number; error?: string };
    if (payload?.error || !payload?.dealId || !payload?.paymentLink) {
      throw new Error(payload?.error ?? 'Could not start the payment.');
    }
    return {
      dealId: payload.dealId,
      paymentLink: payload.paymentLink,
      status: payload.status ?? 'created',
      total: payload.total ?? 0,
      action: { type: 'navigate', route: payload.paymentLink },
    };
  },
};

export const cancelTripTool: ToolDef<{ bookingId: string }, { cancelled: boolean; pending: boolean }> = {
  name: 'cancel_trip',
  description:
    "Cancel one of the renter's own bookings and refund it. Only call once the specific trip is " +
    'unambiguous — resolve it against list_my_bookings first.',
  input_schema: {
    type: 'object',
    properties: { bookingId: { type: 'string' } },
    required: ['bookingId'],
  },
  scope: 'renter',
  effect: 'destructive',
  summary: (input) => `Cancelling booking ${input.bookingId}`,
  async run(ctx, input) {
    const { data, error } = await ctx.supabase.functions.invoke('payhold-cancel-booking', {
      body: { bookingId: input.bookingId },
    });
    if (error) throw new Error(error.message);
    const payload = data as { cancelled?: boolean; pending?: boolean; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return { cancelled: !!payload.cancelled, pending: !!payload.pending };
  },
};

export const respondToBookingTool: ToolDef<{ bookingId: string; action: 'approve' | 'decline' }, unknown> = {
  name: 'respond_to_booking',
  description: 'As the host, approve or decline a pending booking request.',
  input_schema: {
    type: 'object',
    properties: { bookingId: { type: 'string' }, action: { type: 'string', enum: ['approve', 'decline'] } },
    required: ['bookingId', 'action'],
  },
  scope: 'host',
  effect: 'write',
  summary: (input) => `${input.action === 'approve' ? 'Approving' : 'Declining'} booking ${input.bookingId}`,
  async run(ctx, input) {
    const patch = input.action === 'approve'
      ? { state: 'confirmed' }
      : { state: 'declined', payment_status: 'refunded' };
    const row = await run(
      ctx.supabase.from('bookings').update(patch).eq('id', input.bookingId).select('*').maybeSingle(),
    );
    return mapRow(row);
  },
};

export const confirmHandoffTool: ToolDef<
  { bookingId: string; phase: 'pickup' | 'return' },
  unknown
> = {
  name: 'confirm_handoff',
  description:
    "Confirm the caller's own side of a pickup or return handoff for a booking they're party to " +
    '(as renter or host). No photos are attached through the agent — that stays a UI-only step.',
  input_schema: {
    type: 'object',
    properties: {
      bookingId: { type: 'string' },
      phase: { type: 'string', enum: ['pickup', 'return'] },
    },
    required: ['bookingId', 'phase'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Confirming ${input.phase} for booking ${input.bookingId}`,
  async run(ctx, input) {
    const row = await run(
      ctx.supabase.rpc('confirm_handoff', { p_booking_id: input.bookingId, p_phase: input.phase, p_photos: [] }),
    );
    const booking = mapRow(row as Record<string, unknown>) as Record<string, unknown>;
    if (input.phase === 'return') {
      // Best-effort, same reasoning as supabaseClient.ts's confirmHandoff:
      // this is the caller's own side of "I'm satisfied with the trip" —
      // PayHold releases the hold once both sides have confirmed. A booking
      // not on PayHold (or too early in its lifecycle) must never block the
      // handoff itself, so a failure here is swallowed, not thrown.
      await ctx.supabase.functions.invoke('payhold-confirm', { body: { bookingId: input.bookingId } })
        .catch(() => undefined);
    }
    return booking;
  },
};

export const BOOKING_TOOLS: ToolDef[] = [startBookingTool, cancelTripTool, respondToBookingTool, confirmHandoffTool];
