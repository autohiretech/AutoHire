// AutoHire — ai-agent board tools. Mirrors createBoard/addToBoard/
// removeFromBoard in web/src/lib/supabaseClient.ts.

import type { ToolDef } from './types.ts';
import { mapRow, run } from './db.ts';

export const boardCreateTool: ToolDef<{ title: string; circleId?: string; isPublic?: boolean }, unknown> = {
  name: 'board_create',
  description: 'Create a new wishlist board (optionally shared with a circle).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      circleId: { type: 'string' },
      isPublic: { type: 'boolean' },
    },
    required: ['title'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Creating board "${input.title}"`,
  async run(ctx, input) {
    const id = `board-${Date.now()}`;
    const row = await run(
      ctx.supabase.from('boards')
        .insert({ id, title: input.title, created_by: ctx.userId, circle_id: input.circleId ?? null, is_public: input.isPublic ?? false })
        .select('*').single(),
    );
    return { ...(mapRow(row) as Record<string, unknown>), itemCount: 0 };
  },
};

export const boardAddItemTool: ToolDef<
  { boardId: string; listingId: string; note?: string; targetStart?: string; targetEnd?: string },
  { added: true }
> = {
  name: 'board_add_item',
  description: 'Pin a listing to a board, optionally with a note or target dates.',
  input_schema: {
    type: 'object',
    properties: {
      boardId: { type: 'string' },
      listingId: { type: 'string' },
      note: { type: 'string' },
      targetStart: { type: 'string', description: 'ISO date.' },
      targetEnd: { type: 'string', description: 'ISO date.' },
    },
    required: ['boardId', 'listingId'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Adding ${input.listingId} to board ${input.boardId}`,
  async run(ctx, input) {
    await run(
      ctx.supabase.from('board_items').upsert(
        {
          board_id: input.boardId,
          listing_id: input.listingId,
          added_by: ctx.userId,
          note: input.note ?? null,
          target_start: input.targetStart ?? null,
          target_end: input.targetEnd ?? null,
        },
        { onConflict: 'board_id,listing_id' },
      ),
    );
    return { added: true };
  },
};

export const boardRemoveItemTool: ToolDef<{ boardId: string; listingId: string }, { removed: true }> = {
  name: 'board_remove_item',
  description: 'Unpin a listing from a board.',
  input_schema: {
    type: 'object',
    properties: { boardId: { type: 'string' }, listingId: { type: 'string' } },
    required: ['boardId', 'listingId'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Removing ${input.listingId} from board ${input.boardId}`,
  async run(ctx, input) {
    await run(ctx.supabase.from('board_items').delete().eq('board_id', input.boardId).eq('listing_id', input.listingId));
    return { removed: true };
  },
};

export const BOARD_TOOLS: ToolDef[] = [boardCreateTool, boardAddItemTool, boardRemoveItemTool];
