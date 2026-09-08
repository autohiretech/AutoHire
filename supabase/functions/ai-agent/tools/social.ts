// AutoHire — ai-agent social tools: follow/unfollow, circles. Mirrors the
// "Social: follows" / "Social: circles" sections of
// web/src/lib/supabaseClient.ts.

import type { ToolDef } from './types.ts';
import { mapRow, run } from './db.ts';

export const followTool: ToolDef<{ profileId: string }, { following: true }> = {
  name: 'follow',
  description: 'Follow another user (renter or host) by profile id.',
  input_schema: { type: 'object', properties: { profileId: { type: 'string' } }, required: ['profileId'] },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Following ${input.profileId}`,
  async run(ctx, input) {
    await run(
      ctx.supabase.from('follows')
        .upsert({ follower_id: ctx.userId, followee_id: input.profileId }, { onConflict: 'follower_id,followee_id' }),
    );
    return { following: true };
  },
};

export const unfollowTool: ToolDef<{ profileId: string }, { following: false }> = {
  name: 'unfollow',
  description: 'Unfollow a user by profile id.',
  input_schema: { type: 'object', properties: { profileId: { type: 'string' } }, required: ['profileId'] },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Unfollowing ${input.profileId}`,
  async run(ctx, input) {
    await run(ctx.supabase.from('follows').delete().eq('follower_id', ctx.userId).eq('followee_id', input.profileId));
    return { following: false };
  },
};

export const createCircleTool: ToolDef<{ name: string; kind: string; country?: string }, unknown> = {
  name: 'create_circle',
  description: 'Create a new circle (a named group of renters/hosts) and join it as owner.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string' }, kind: { type: 'string' }, country: { type: 'string' } },
    required: ['name', 'kind'],
  },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Creating circle "${input.name}"`,
  async run(ctx, input) {
    const id = `circle-${Date.now()}`;
    await run(
      ctx.supabase.from('circles').insert({ id, name: input.name, kind: input.kind, created_by: ctx.userId, country: input.country ?? null }),
    );
    await run(ctx.supabase.from('circle_members').insert({ circle_id: id, profile_id: ctx.userId, role: 'owner', status: 'active' }));
    const row = await run(ctx.supabase.from('circles').select('*').eq('id', id).maybeSingle());
    return mapRow(row);
  },
};

export const leaveCircleTool: ToolDef<{ circleId: string }, { left: true }> = {
  name: 'leave_circle',
  description: 'Leave a circle the caller belongs to.',
  input_schema: { type: 'object', properties: { circleId: { type: 'string' } }, required: ['circleId'] },
  scope: 'any',
  effect: 'write',
  summary: (input) => `Leaving circle ${input.circleId}`,
  async run(ctx, input) {
    await run(ctx.supabase.from('circle_members').delete().eq('circle_id', input.circleId).eq('profile_id', ctx.userId));
    return { left: true };
  },
};

export const createCircleInviteTool: ToolDef<{ circleId: string }, { token: string }> = {
  name: 'create_circle_invite',
  description: 'Create a share-link invite token for a circle the caller owns/belongs to.',
  input_schema: { type: 'object', properties: { circleId: { type: 'string' } }, required: ['circleId'] },
  scope: 'any',
  effect: 'write',
  summary: () => 'Creating an invite link',
  async run(ctx, input) {
    const id = `cinv-${Date.now()}`;
    const token = crypto.randomUUID();
    await run(
      ctx.supabase.from('circle_invites').insert({ id, circle_id: input.circleId, invited_by: ctx.userId, token }).select('*').single(),
    );
    return { token };
  },
};

export const SOCIAL_TOOLS: ToolDef[] = [followTool, unfollowTool, createCircleTool, leaveCircleTool, createCircleInviteTool];
