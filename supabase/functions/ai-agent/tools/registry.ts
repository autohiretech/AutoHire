// AutoHire — ai-agent tool registry. The tool registry IS the app: every
// entry here is one thing a signed-in renter or host could already do by
// hand (see the per-file comments for exactly which supabaseClient.ts
// method it mirrors), executed with the caller's own JWT so RLS is the
// real permission check — `scope` below is a UX-level pre-filter (don't
// even offer a host tool to a renter), not the security boundary.

import type { ToolDef } from './types.ts';
import { READ_TOOLS } from './read.ts';
import { ACTION_TOOLS } from './actions.ts';
import { WATCHLIST_TOOLS } from './watchlist.ts';
import { BOARD_TOOLS } from './boards.ts';
import { MESSAGING_TOOLS } from './messaging.ts';
import { BOOKING_TOOLS } from './bookings.ts';
import { REVIEW_TOOLS } from './reviews.ts';
import { PROFILE_TOOLS } from './profile.ts';
import { HOST_TOOLS } from './host.ts';
import { SOCIAL_TOOLS } from './social.ts';

export const ALL_TOOLS: ToolDef[] = [
  ...READ_TOOLS,
  ...ACTION_TOOLS,
  ...WATCHLIST_TOOLS,
  ...BOARD_TOOLS,
  ...MESSAGING_TOOLS,
  ...BOOKING_TOOLS,
  ...REVIEW_TOOLS,
  ...PROFILE_TOOLS,
  ...HOST_TOOLS,
  ...SOCIAL_TOOLS,
];

export const TOOLS_BY_NAME: Map<string, ToolDef> = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export * from './types.ts';
