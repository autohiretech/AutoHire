// AutoHire — ai-agent tool registry types.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { JsonSchema } from '../providers/adapter.ts';
import type { UserRole } from '../types.ts';

export type Scope = 'renter' | 'host' | 'admin' | 'any';
export type Effect = 'read' | 'write' | 'money' | 'destructive';

export interface ToolCtx {
  /** Built with the CALLER's own JWT (anon key + Authorization header) — every query runs under RLS as this user, never the service role. */
  supabase: SupabaseClient;
  userId: string;
  role: UserRole;
  country?: string;
  currency?: string;
  /** From the client's `context` — listing ids currently on screen, so a tool can resolve "the second one" without a fresh query. */
  visibleListingIds?: string[];
  route?: string;
  filters?: Record<string, unknown>;
  /** Where the renter actually is, when the client knows and sent it — a
   * real geolocation fix or their saved home location, resolved on the
   * client. The model never sees the numbers; it asks for "near me" and this
   * is what that resolves to. Absent means we genuinely don't know, and
   * nothing should pretend otherwise. */
  userLocation?: { lat: number; lng: number; label?: string };
}

export interface ToolDef<I = unknown, R = unknown> {
  name: string;
  description: string;
  input_schema: JsonSchema;
  scope: Scope;
  effect: Effect;
  /** One-line, present-tense template for the SSE `step` event — e.g. "Searching SUVs in Kigali". Must not throw on a partial/odd result. */
  summary(input: I, result: R): string;
  run(ctx: ToolCtx, input: I): Promise<R>;
}

/** `scope` vs. the caller's actual `profiles.role` — 'host' means the 'owner' role (the app's own naming: a signed-in user becomes an 'owner' the moment they list a car; see supabaseClient.ts createListing). */
export function scopeAllows(scope: Scope, role: UserRole): boolean {
  if (scope === 'any') return true;
  if (scope === 'admin') return role === 'admin';
  if (scope === 'host') return role === 'owner' || role === 'admin';
  if (scope === 'renter') return role === 'renter' || role === 'owner' || role === 'admin';
  return false;
}
