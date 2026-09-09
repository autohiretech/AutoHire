// AutoHire — ai-agent Edge Function.
//
// The renter/host's whole interaction with the app as one tool-calling
// agent, replacing ai-search's single hand-rolled function-calling turn with
// a real loop (model → tool → result → model, up to 8 steps) over the same
// kind of thing ai-search already did — except the tool registry now mirrors
// essentially all of web/src/lib/supabaseClient.ts, not 7 hand-picked
// actions, and every tool runs AS THE SIGNED-IN USER (their own JWT, so RLS
// is the real permission boundary) rather than the service role deciding on
// their behalf.
//
// Kept deliberately runnable outside the Supabase Edge runtime — every
// import is `npm:`/relative (no `Deno.serve` edge-only globals beyond what
// vanilla Deno itself provides, no service-role requirement) — so it can be
// smoke-tested with:
//
//   deno run -A --env-file=.env.ai-agent supabase/functions/ai-agent/index.ts
//
// with SUPABASE_URL, SUPABASE_ANON_KEY, AI_AGENT_CONFIRM_SECRET (and a real
// user's access token in the Authorization header of the request you send
// it) in that env file. SUPABASE_SERVICE_ROLE_KEY is OPTIONAL — see the rate
// limit section below — and nothing else here ever touches it: identity
// itself is verified with the anon key + the caller's own JWT, so RLS
// applies to every query this function makes, no exceptions.
//
// Request:  POST { sessionId?, message, confirmToken?, context: { route,
//           filters, visibleListingIds, country, currency } }
// Response: text/event-stream — `step` {tool,summary}, `action`
//           {type:'navigate'|'filters'|'highlight'|'toast'|'confirm',...},
//           `say` {text}, `chips` [{label,send}], `done` {sessionId},
//           `error` {message}.
//
// Secrets:
//   AI_AGENT_CONFIRM_SECRET  required — HMAC key signing confirm tokens.
//   AI_AGENT_PROVIDER        'anthropic' (default) | 'mistral'
//   AI_AGENT_MODEL           defaults to a sane per-provider choice below
//   ANTHROPIC_API_KEY        required when AI_AGENT_PROVIDER=anthropic
//   MISTRAL_API_KEY          required when AI_AGENT_PROVIDER=mistral
//   ALLOWED_ORIGIN           CORS origin lock, same as every sibling function
//
// Deploy:  supabase functions deploy ai-agent
//   (verify_jwt is OFF in config.toml — same reason as create-payment-intent
//   / dynamic-endpoint: this function verifies the JWT itself, so the
//   gateway's own check would otherwise 401 the CORS preflight.)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { AnthropicAdapter } from './providers/anthropic.ts';
import { GROQ_DEFAULT_MODELS, GroqAdapter, MistralAdapter } from './providers/openai-compatible.ts';
import type { ProviderAdapter } from './providers/adapter.ts';
import { ALL_TOOLS } from './tools/registry.ts';
import type { ToolCtx } from './tools/types.ts';
import { buildSystemPrompt } from './prompt.ts';
import { runLoop } from './loop.ts';
import type { LoopEvent, ToolLogEntry } from './loop.ts';
import type { TokenLedger } from './confirm.ts';
import type { UserRole } from './types.ts';
import { sseLine, SSE_RESPONSE_HEADERS } from './sse.ts';

const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 60;

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
}

/**
 * Replay guard for confirm tokens, backed by `ai_turns.confirm_jti` (a
 * unique index — see the migration). `consume()` writes immediately, not at
 * end-of-request, so a crash right after a money/destructive tool runs can't
 * leave the token silently reusable.
 */
class SupabaseTokenLedger implements TokenLedger {
  constructor(private readonly client: SupabaseClient, private readonly sessionId: string) {}

  async wasConsumed(jti: string): Promise<boolean> {
    const { data, error } = await this.client.from('ai_turns').select('id').eq('confirm_jti', jti).maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  }

  async consume(jti: string): Promise<void> {
    const { error } = await this.client.from('ai_turns').insert({
      id: `turn-${crypto.randomUUID()}`,
      session_id: this.sessionId,
      role: 'tool',
      content: {},
      tool_log: [],
      confirm_jti: jti,
    });
    // A unique-violation here means a genuine race lost — the other request
    // already consumed it. That's the guard working, not a failure to log.
    if (error && !/duplicate key|unique constraint/i.test(error.message)) throw new Error(error.message);
  }
}

/**
 * The one place "we know where the renter is" is decided — everything
 * downstream (the prompt paragraph, `nearMe` on apply_filters/list_listings,
 * the haversine sort in migration 075) branches on whether this returns a
 * point. So the bar is a coordinate that can actually be somewhere, not just
 * a value that happens to be typed `number`:
 *
 *   - `== null` is deliberately NOT what's checked, because 0 is a real
 *     latitude and a real longitude — the equator runs through Uganda and
 *     Kenya, and the prime meridian through Ghana. Falsy-testing a coordinate
 *     is how a renter standing on one gets told we don't know where they are.
 *   - `Number.isFinite` is not belt-and-braces: `JSON.parse('{"lat":1e999}')`
 *     yields `Infinity`, which is `typeof 'number'`, survives every range
 *     check written as a comparison, and reaches Postgres as an `acos`
 *     argument that returns NULL — silently scrambling the distance order
 *     instead of failing.
 *   - Out-of-range values are dropped rather than clamped. A clamped 500°
 *     is a confident answer about a place nobody is; `undefined` makes the
 *     agent say it doesn't know, which is the truth.
 */
function userLocationOf(
  location: { lat?: number; lng?: number; label?: string } | undefined,
): { lat: number; lng: number; label?: string } | undefined {
  const { lat, lng, label } = location ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng, label };
}

/** How many past turns of a session are replayed to the model. Turns are
 * user/assistant rows, so this is roughly five exchanges — enough for
 * "cheaper than that" or "the second one" to resolve, without every request
 * dragging the whole conversation through the token budget. */
const HISTORY_TURNS = 10;

interface RequestBody {
  sessionId?: string;
  message?: string;
  confirmToken?: string;
  context?: {
    route?: string;
    filters?: Record<string, unknown>;
    visibleListingIds?: string[];
    country?: string;
    currency?: string;
    /** The renter's own coordinate, resolved on the client (a geolocation
     * fix or their saved home location). Optional by design — absent means
     * unknown, and the agent is told so rather than guessing. */
    location?: { lat?: number; lng?: number; label?: string };
  };
}

function pickProvider(): { provider: ProviderAdapter; model: string } | { error: string } {
  const name = Deno.env.get('AI_AGENT_PROVIDER') ?? 'anthropic';
  if (name === 'groq') {
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) return { error: 'AI agent is not configured yet (missing GROQ_API_KEY).' };
    // An ordered fallback chain rather than one model, because this account is
    // on Groq's free tier: 429s and per-model capacity refusals are routine
    // there, and a rate limit on the biggest model should cost the renter a
    // slightly worse answer rather than the whole turn. `GroqAdapter` walks the
    // list on 429/404/5xx and stops dead on anything else — see
    // `worthFallingBackFrom`.
    //
    // `AI_AGENT_MODELS` (comma-separated) reorders or replaces it without a
    // deploy; `AI_AGENT_MODEL` still pins a single one, so the older env var
    // keeps meaning what it always did. Every default was verified present on
    // this account AND sent a real tool call — see `GROQ_DEFAULT_MODELS`.
    const pinned = Deno.env.get('AI_AGENT_MODEL');
    const models = pinned
      ? [pinned]
      : (Deno.env.get('AI_AGENT_MODELS')?.split(',') ?? GROQ_DEFAULT_MODELS);
    const adapter = new GroqAdapter(models, apiKey);
    return { provider: adapter, model: adapter.primaryModel };
  }
  if (name === 'mistral') {
    const apiKey = Deno.env.get('MISTRAL_API_KEY');
    if (!apiKey) return { error: 'AI agent is not configured yet (missing MISTRAL_API_KEY).' };
    const model = Deno.env.get('AI_AGENT_MODEL') ?? 'mistral-small-latest';
    return { provider: new MistralAdapter(model, apiKey), model };
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return { error: 'AI agent is not configured yet (missing ANTHROPIC_API_KEY).' };
  // See the report for why claude-sonnet-5 is the recommended default:
  // reliable multi-tool agentic calling at roughly a third of Opus 5's
  // per-token cost and meaningfully lower latency — the right trade for a
  // consumer-facing, many-calls-per-session agent. AI_AGENT_MODEL overrides
  // it (e.g. to claude-opus-5) without a code change.
  const model = Deno.env.get('AI_AGENT_MODEL') ?? 'claude-sonnet-5';
  return { provider: new AnthropicAdapter(model, new Anthropic({ apiKey })), model };
}

Deno.serve({ port: Number(Deno.env.get('PORT') ?? '8000') }, async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const confirmSecret = Deno.env.get('AI_AGENT_CONFIRM_SECRET');
  if (!confirmSecret) return json({ error: 'ai-agent is not configured (missing AI_AGENT_CONFIRM_SECRET).' }, 503);

  const selected = pickProvider();
  if ('error' in selected) return json({ error: selected.error }, 503);
  const { provider } = selected;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'ai-agent is not configured (missing SUPABASE_URL/SUPABASE_ANON_KEY).' }, 503);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Missing authorization token.' }, 401);

  // The only client any TOOL ever runs against — anon key + the caller's own
  // JWT. Every data read or write a tool makes (including verifying who the
  // caller is) goes through this, so RLS is the real permission boundary
  // throughout. A second, service-role client is built further down, but
  // only to call the grant-locked `rate_limit_hit` RPC — it never touches
  // app data and no tool ever sees it.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);
  const userId = userData.user.id;

  // Best-effort per-user throttle. `rate_limit_hit` is SECURITY DEFINER but
  // its EXECUTE grant is revoked from `anon`/`authenticated` (migration 030)
  // — deliberately, since it takes an arbitrary key and an authenticated
  // caller could otherwise spam another user's bucket. Only a service-role
  // client can call it, so this is skipped (not enforced) wherever
  // SUPABASE_SERVICE_ROLE_KEY isn't set — true for the local `deno run`
  // rehearsal, never true for the deployed function (Supabase injects it).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceRoleKey) {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: allowed, error: rateErr } = await admin.rpc('rate_limit_hit', {
      p_key: `ai-agent:${userId}`,
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (rateErr) console.error('ai-agent rate_limit_hit error (failing open)', rateErr);
    else if (allowed === false) return json({ error: 'Too many requests. Please wait a moment and try again.' }, 429);
  } else {
    console.warn('ai-agent: SUPABASE_SERVICE_ROLE_KEY not set — rate limiting is disabled this run.');
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return json({ error: 'A message is required.' }, 400);
  const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : undefined;
  const context = body.context ?? {};

  const { data: profileRow } = await supabase.from('profiles').select('role, country').eq('id', userId).maybeSingle();
  const role: UserRole = (profileRow?.role as UserRole) ?? 'renter';
  const country = context.country ?? (profileRow?.country as string | undefined);

  // Session: reuse if the caller named one (RLS confirms it's theirs — a
  // stranger's id just comes back null and we start a fresh one instead of
  // erroring), otherwise start a new one.
  const requestedId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  let sessionId = requestedId;
  if (requestedId) {
    const { data: existing } = await supabase.from('ai_sessions').select('id').eq('id', requestedId).maybeSingle();
    if (!existing) sessionId = undefined;
  }
  if (!sessionId) {
    sessionId = `aisess-${crypto.randomUUID()}`;
    const { error: createErr } = await supabase.from('ai_sessions').insert({
      id: sessionId,
      user_id: userId,
      route: context.route ?? null,
      filters: context.filters ?? {},
    });
    if (createErr) return json({ error: `Could not start a session: ${createErr.message}` }, 500);
  } else {
    await supabase.from('ai_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);
  }

  // Earlier turns, oldest first — read BEFORE this turn's own row is
  // inserted below, or the current message would come back as history and be
  // sent to the model twice. Capped at the most recent HISTORY_TURNS because
  // this replays into every request's token budget; a rental conversation
  // that needs more than a few turns of memory is one the renter should be
  // finishing on the results, not in the field.
  //
  // Only the plain text of each turn is replayed. Tool logs and actions are
  // deliberately left out: they are a record of what the app did, not of what
  // was said, and feeding them back invites the model to re-issue an action
  // it already performed.
  const { data: priorTurns } = await supabase
    .from('ai_turns')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS);

  const history = (priorTurns ?? [])
    .reverse()
    .map((row) => {
      const text = (row.content as { text?: unknown } | null)?.text;
      if (typeof text !== 'string' || !text.trim()) return null;
      const role = row.role === 'assistant' ? 'assistant' : 'user';
      return { role, parts: [{ type: 'text' as const, text }] };
    })
    .filter((m): m is { role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] } => m !== null);

  await supabase.from('ai_turns').insert({
    id: `turn-${crypto.randomUUID()}`,
    session_id: sessionId,
    role: 'user',
    content: { text: message, confirmed: !!confirmToken },
    tool_log: [],
  });

  const ctx: ToolCtx = {
    supabase,
    userId,
    role,
    country,
    currency: context.currency,
    visibleListingIds: context.visibleListingIds,
    route: context.route,
    filters: context.filters,
    userLocation: userLocationOf(context.location),
  };
  const systemPrompt = buildSystemPrompt({ route: context.route, country, currency: context.currency, role, filters: context.filters, visibleListingIds: context.visibleListingIds, userLocation: ctx.userLocation });
  const tokenLedger = new SupabaseTokenLedger(supabase, sessionId);

  const encoder = new TextEncoder();
  let finalText: string | null = null;
  let finalChips: unknown[] = [];
  const actions: unknown[] = [];
  let toolLog: ToolLogEntry[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseLine(event, data)));
      try {
        for await (
          const event of runLoop({
            provider,
            tools: ALL_TOOLS,
            ctx,
            systemPrompt,
            message,
            history,
            confirmToken,
            confirmSecret,
            tokenLedger,
            onToolLog: (entries) => {
              toolLog = entries;
            },
          }) as AsyncGenerator<LoopEvent>
        ) {
          switch (event.type) {
            case 'step':
              write('step', { tool: event.tool, summary: event.summary });
              break;
            case 'action':
              actions.push(event.action);
              write('action', event.action);
              break;
            case 'say':
              finalText = event.text;
              write('say', { text: event.text });
              break;
            case 'chips':
              finalChips = event.chips;
              write('chips', event.chips);
              break;
            case 'error':
              write('error', { message: event.message });
              break;
          }
        }
      } catch (err) {
        write('error', { message: err instanceof Error ? err.message : String(err) });
      }

      await supabase.from('ai_turns').insert({
        id: `turn-${crypto.randomUUID()}`,
        session_id: sessionId,
        role: 'assistant',
        content: { text: finalText, chips: finalChips, actions },
        tool_log: toolLog,
      }).then(({ error }) => {
        if (error) console.error('ai-agent: failed to persist assistant turn', error);
      });

      write('done', { sessionId });
      controller.close();
    },
  });

  return new Response(stream, { headers: { ...corsHeaders(), ...SSE_RESPONSE_HEADERS } });
});
