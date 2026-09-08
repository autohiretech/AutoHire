import { getSupabase } from '@/lib/supabase';
import type { ListingFilters } from '@/lib/types';

/**
 * Client for the `ai-agent` Edge Function — the one surface behind AiPage's
 * research field. Replaces the old single-shot `ai-search` function (see
 * `client.aiSearch` in `supabaseClient.ts`, now unused): instead of one
 * request/response pair, a turn is a Server-Sent Events stream so the field
 * can show live progress ("Searching…", "Found 12") and a multi-step plan
 * (search, then a clarifying question, then an action) without the renter
 * ever seeing more than one line at a time.
 *
 * There is no "session" on the wire in the old sense (no DB-backed chat
 * history row, no cookie) — continuity across turns is just `sessionId`,
 * an opaque token the function hands back in its `done` event and expects
 * unchanged on the next call. The caller (ResearchField) is what persists
 * it, in `sessionStorage`, so it survives a navigate to /cars/:id and back
 * but not a closed tab.
 */

export interface AgentContext {
  route: string;
  /** Where the renter arrived from, if relevant — e.g. a specific car's page,
   * so "book this one" resolves without asking which car. */
  from?: string;
  listingId?: string;
  filters: ListingFilters;
  visibleListingIds: string[];
  country: string;
  currency: string;
}

export type AgentAction =
  | { type: 'navigate'; to: string }
  | { type: 'filters'; filters: ListingFilters; clear?: (keyof ListingFilters)[] }
  | { type: 'highlight'; ids: string[] }
  | { type: 'toast'; text: string }
  | { type: 'confirm'; summary: string; token: string };

export interface AgentChip {
  label: string;
  send: string;
}

export type AgentEvent =
  | { kind: 'step'; tool: string; summary: string }
  | { kind: 'action'; action: AgentAction }
  | { kind: 'say'; text: string }
  | { kind: 'chips'; chips: AgentChip[] }
  | { kind: 'done'; sessionId: string }
  | { kind: 'error'; message: string };

export interface AgentRequest {
  sessionId?: string;
  message: string;
  /** Present only when replying "yes" to a `confirm` action — echoes the
   * token that action carried, so the function knows this reply is the
   * confirmation and not a new, unrelated message. */
  confirmToken?: string;
  context: AgentContext;
}

/**
 * Streams one turn of `ai-agent`, calling `onEvent` as each SSE event
 * arrives. Never throws — a transport failure (not deployed, network,
 * non-200) is reported as an `error` event like any other, so callers only
 * need the one code path.
 *
 * Hand-rolled SSE parsing rather than the browser's `EventSource`:
 * `EventSource` can only send a GET with no custom headers, and this call
 * needs both a JSON POST body and the renter's bearer token.
 */
export async function streamAgentTurn(
  req: AgentRequest,
  onEvent: (evt: AgentEvent) => void,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    onEvent({ kind: 'error', message: 'The assistant is not configured yet.' });
    return;
  }

  let token = anonKey;
  try {
    const { data } = await getSupabase().auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    // Fall back to the anon key — the function itself will reject if it
    // actually requires a signed-in identity.
  }

  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/ai-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify(req),
      signal: opts?.signal,
    });
  } catch {
    onEvent({ kind: 'error', message: "Couldn't reach the assistant — check your connection." });
    return;
  }

  if (!res.ok || !res.body) {
    onEvent({
      kind: 'error',
      message:
        res.status === 404
          ? 'The assistant isn’t deployed yet.'
          : `The assistant failed (${res.status}). Try again.`,
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE frames are separated by a blank line; \r\n-terminated streams
      // still contain a bare \n\n once the decoder normalizes text, but be
      // defensive and strip any stray \r left in individual lines below.
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const evt = parseFrame(raw);
        if (evt) onEvent(evt);
      }
    }
    if (buffer.trim()) {
      const evt = parseFrame(buffer);
      if (evt) onEvent(evt);
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      onEvent({ kind: 'error', message: 'Lost connection to the assistant.' });
    }
  }
}

function parseFrame(raw: string): AgentEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  switch (eventName) {
    case 'step':
      return { kind: 'step', tool: String(p.tool ?? ''), summary: String(p.summary ?? '') };
    case 'action':
      return { kind: 'action', action: payload as AgentAction };
    case 'say':
      return { kind: 'say', text: String(p.text ?? '') };
    case 'chips': {
      const list = Array.isArray(payload) ? payload : Array.isArray(p.chips) ? p.chips : [];
      return { kind: 'chips', chips: list as AgentChip[] };
    }
    case 'done':
      return { kind: 'done', sessionId: String(p.sessionId ?? '') };
    case 'error':
      return { kind: 'error', message: String(p.message ?? 'Something went wrong.') };
    default:
      return null;
  }
}
