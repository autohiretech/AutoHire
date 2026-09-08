// AutoHire — ai-agent watchlist tools. Mirrors watchListing/unwatchListing
// in web/src/lib/supabaseClient.ts exactly (same upsert-by-PK / delete).

import type { ToolDef } from './types.ts';
import { run } from './db.ts';

export const watchlistAddTool: ToolDef<{ listingId: string }, { watching: true }> = {
  name: 'watchlist_add',
  description: "Add a listing to the signed-in user's watchlist.",
  input_schema: { type: 'object', properties: { listingId: { type: 'string' } }, required: ['listingId'] },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Watching ${input.listingId}`,
  async run(ctx, input) {
    await run(
      ctx.supabase.from('watchlist')
        .upsert({ profile_id: ctx.userId, listing_id: input.listingId }, { onConflict: 'profile_id,listing_id' })
        .select('listing_id'),
    );
    return { watching: true };
  },
};

export const watchlistRemoveTool: ToolDef<{ listingId: string }, { watching: false }> = {
  name: 'watchlist_remove',
  description: "Remove a listing from the signed-in user's watchlist.",
  input_schema: { type: 'object', properties: { listingId: { type: 'string' } }, required: ['listingId'] },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Unwatching ${input.listingId}`,
  async run(ctx, input) {
    await run(
      ctx.supabase.from('watchlist').delete().eq('profile_id', ctx.userId).eq('listing_id', input.listingId)
        .select('listing_id'),
    );
    return { watching: false };
  },
};

export const WATCHLIST_TOOLS: ToolDef[] = [watchlistAddTool, watchlistRemoveTool];
