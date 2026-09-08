// AutoHire — ai-agent messaging tools. Mirrors getOrCreateConversation +
// sendMessage in web/src/lib/supabaseClient.ts.

import type { ToolDef } from './types.ts';
import { run } from './db.ts';

export const messageHostTool: ToolDef<{ listingId: string; message: string }, { conversationId: string }> = {
  name: 'message_host',
  description:
    "Send a message to a listing's host on the signed-in user's behalf, opening the thread if one doesn't " +
    'already exist. Write the message so it reads like something the user would actually say.',
  input_schema: {
    type: 'object',
    properties: { listingId: { type: 'string' }, message: { type: 'string' } },
    required: ['listingId', 'message'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Messaging the host about ${input.listingId}`,
  async run(ctx, input) {
    const listing = await run(
      ctx.supabase.from('listings').select('host_id').eq('id', input.listingId).maybeSingle(),
    );
    if (!listing) throw new Error(`Listing ${input.listingId} not found.`);
    const hostId = listing.host_id as string;

    const existing = await run(
      ctx.supabase.from('conversations').select('*')
        .eq('listing_id', input.listingId).eq('renter_id', ctx.userId).eq('host_id', hostId).maybeSingle(),
    );
    const conversation = existing ?? await run(
      ctx.supabase.from('conversations').insert({
        id: `conv-${Date.now()}`,
        listing_id: input.listingId,
        renter_id: ctx.userId,
        host_id: hostId,
        last_message_preview: '',
        last_message_at: new Date().toISOString(),
        unread: 0,
      }).select('*').single(),
    );
    const conversationId = conversation.id as string;

    const sentAt = new Date().toISOString();
    await run(
      ctx.supabase.from('messages').insert({
        id: `msg-${Date.now()}`,
        conversation_id: conversationId,
        sender_id: ctx.userId,
        body: input.message,
        sent_at: sentAt,
      }).select('*').single(),
    );
    await run(
      ctx.supabase.from('conversations')
        .update({ last_message_preview: input.message.trim(), last_message_at: sentAt, unread: 0 })
        .eq('id', conversationId).select('id'),
    );
    return { conversationId };
  },
};

export const openConversationTool: ToolDef<{ conversationId: string }, { action: { type: 'navigate'; route: string } }> = {
  name: 'open_conversation',
  description: 'Take the user to an existing message thread by id.',
  input_schema: { type: 'object', properties: { conversationId: { type: 'string' } }, required: ['conversationId'] },
  scope: 'any',
  effect: 'write',
  summary: () => 'Opening the conversation',
  run(_ctx, input) {
    return Promise.resolve({ action: { type: 'navigate', route: `/messages/${input.conversationId}` } });
  },
};

export const MESSAGING_TOOLS: ToolDef[] = [messageHostTool, openConversationTool];
