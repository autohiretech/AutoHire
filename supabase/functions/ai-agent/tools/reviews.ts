// AutoHire — ai-agent review tool. Mirrors createReview in
// web/src/lib/supabaseClient.ts.

import type { ToolDef } from './types.ts';
import { mapRow, run } from './db.ts';

export const createReviewTool: ToolDef<
  { bookingId: string; direction: 'renter_to_host' | 'host_to_renter'; rating: number; body: string },
  unknown
> = {
  name: 'create_review',
  description: 'Leave a review for a completed trip, in the direction the caller is party to.',
  input_schema: {
    type: 'object',
    properties: {
      bookingId: { type: 'string' },
      direction: { type: 'string', enum: ['renter_to_host', 'host_to_renter'] },
      rating: { type: 'integer', description: '1 to 5.' },
      body: { type: 'string' },
    },
    required: ['bookingId', 'direction', 'rating', 'body'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Leaving a ${input.rating}-star review for booking ${input.bookingId}`,
  async run(ctx, input) {
    const booking = await run(
      ctx.supabase.from('bookings').select('renter_id, host_id').eq('id', input.bookingId).single(),
    );
    if (!booking) throw new Error(`Booking ${input.bookingId} not found`);
    const toHost = input.direction === 'renter_to_host';
    const row = await run(
      ctx.supabase.from('reviews').insert({
        id: `rv-${Date.now()}`,
        booking_id: input.bookingId,
        author_id: toHost ? booking.renter_id : booking.host_id,
        subject_id: toHost ? booking.host_id : booking.renter_id,
        direction: input.direction,
        rating: input.rating,
        body: input.body,
        created_at: new Date().toISOString(),
      }).select('*').single(),
    );
    return mapRow(row);
  },
};

export const REVIEW_TOOLS: ToolDef[] = [createReviewTool];
