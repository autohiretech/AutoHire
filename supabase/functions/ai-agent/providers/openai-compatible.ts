// AutoHire — ai-agent adapter for any OpenAI-shaped chat-completions API.
//
// Started life as the Mistral adapter, ported from `ai-search/index.ts`. It is
// parameterised rather than copied because Mistral and Groq speak the *same*
// wire format — `POST {base}/chat/completions`, OpenAI-shaped tool calling
// (`{type:'function', function:{name, description, parameters}}`), a tool call
// as an assistant message with `tool_calls`, its result as a separate
// `role:'tool'` message keyed by `tool_call_id`. Two files differing only in a
// URL and a word in an error message would be two files free to drift, and the
// one that drifts is whichever nobody is looking at.
//
// Plain `fetch`, no SDK — one less npm dependency for the Deno runtime to
// resolve, the same reasoning the original was written with.
//
// Not token-streamed: the SSE chunk format for interleaved text + tool-call
// deltas is not documented in the same request/response reference this was
// built from, and a wrong guess would silently corrupt tool-call JSON. One
// non-streaming request per turn, with the full text replayed as a single
// `text_delta` — `loop.ts` and the SSE layer do not care whether text arrived
// in one chunk or many, so nothing upstream changes; the reader just sees that
// turn's text land in one write rather than a token-by-token trickle.

import type { AdapterEvent, ChatMessage, CompleteParams, ProviderAdapter, ToolSpec } from './adapter.ts';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiResponse {
  choices?: { message?: OpenAiMessage; finish_reason?: string }[];
}

function toOpenAiTools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/**
 * Flatten our provider-neutral `ChatMessage[]` into the OpenAI shape.
 *
 * `tool_use`/`tool_result` do not exist as such here: a tool call is an
 * assistant message carrying `tool_calls`, and its result is a separate
 * `role:'tool'` message keyed by `tool_call_id`. So a pair our internal format
 * keeps as two parts of one message (Anthropic's shape) becomes two messages.
 *
 * Note what is deliberately *not* sent: no `name` on a message, no `n`, no
 * `temperature`. Groq rejects the first outright, requires the second to be 1,
 * and silently rewrites `temperature: 0` to `1e-8` — none of which we want to
 * discover through a 400 on a live request.
 */
function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    const text = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
    const toolUses = m.parts.filter((p) => p.type === 'tool_use') as { id: string; name: string; input: unknown }[];
    const toolResults = m.parts.filter((p) => p.type === 'tool_result') as { toolUseId: string; content: string }[];

    if (m.role === 'assistant' && toolUses.length > 0) {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
        })),
      });
      continue;
    }
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content });
      }
      continue;
    }
    out.push({ role: m.role, content: text });
  }
  return out;
}

export interface OpenAiCompatibleConfig {
  /** Everything before `/chat/completions`, no trailing slash. */
  baseUrl: string;
  /** What to call this API in an error a human will read. */
  label: string;
}

/**
 * Is this status worth asking a *different* model about?
 *
 * The distinction matters more than it looks. A free-tier account hits 429 and
 * per-model capacity limits constantly, and those are exactly what another
 * model can answer. An auth failure or a malformed request is ours, and the
 * next model will fail identically — walking the whole chain to rediscover
 * that would bury the real cause under the last model's error and burn three
 * round trips doing it.
 */
function worthFallingBackFrom(status: number): boolean {
  // 429 rate limit, 413 too-large / TPM refusal, 5xx upstream trouble, 404 for
  // a model decommissioned out from under us.
  //
  // **413 is here for completeness, not because it will usually help.** On
  // Groq's free tier every model shares one 8,000 tokens-per-minute
  // allowance — measured, per model, from `x-ratelimit-limit-tokens` — so a
  // request too large for the first model is too large for all of them. The
  // fallback still tries, because the limit is per model per minute and the
  // next one may not have been spent yet; but a persistent 413 means the
  // request itself has to get smaller, and no chain fixes that.
  return status === 429 || status === 413 || status === 404 || status >= 500;
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  private readonly models: string[];

  constructor(
    models: string | string[],
    private readonly apiKey: string,
    private readonly config: OpenAiCompatibleConfig,
  ) {
    const list = (Array.isArray(models) ? models : [models]).map((m) => m.trim()).filter(Boolean);
    if (list.length === 0) throw new Error(`${config.label}: no model configured`);
    this.models = list;
  }

  /** The model this adapter prefers, for logging and for what gets persisted. */
  get primaryModel(): string {
    return this.models[0];
  }

  async *complete(params: CompleteParams): AsyncGenerator<AdapterEvent> {
    const body = {
      messages: [{ role: 'system', content: params.system }, ...toOpenAiMessages(params.messages)],
      tools: toOpenAiTools(params.tools),
      tool_choice: 'auto',
    };

    let res: Response | undefined;
    const refusals: string[] = [];

    // Ordered fallback. Safe to retry across models because this adapter is
    // non-streaming: the request completes fully before a single event is
    // yielded, so a model that failed cannot have emitted half a turn. A
    // streaming implementation would need to buffer until the first token to
    // keep that property.
    for (const model of this.models) {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model, ...body }),
      });

      if (res.ok) break;

      const errText = await res.text().catch(() => '');
      // Long enough to keep the numbers in "Limit 8000, Requested 12345" —
      // truncating those away leaves an operator knowing only that something
      // was too big, which is the one thing they could already guess.
      refusals.push(`${model} → ${res.status} ${errText.slice(0, 400)}`);

      if (!worthFallingBackFrom(res.status)) break;
      res = undefined;
    }

    if (!res?.ok) {
      yield {
        type: 'done',
        stopReason: 'error',
        // Every attempt, not just the last: "the fallback chain was exhausted"
        // and "the key is wrong" look identical from one message, and they
        // need completely different things done about them.
        error: `${this.config.label} API error — ${refusals.join('; ')}`,
      };
      return;
    }

    const data = (await res.json()) as OpenAiResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;

    if (message?.content) yield { type: 'text_delta', text: message.content };

    for (const call of message?.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        // Malformed tool-call JSON — surface as an empty input rather than
        // crashing the turn; the tool's own input validation will reject it
        // with a message the model can react to.
      }
      yield { type: 'tool_call', id: call.id, name: call.function.name, input };
    }

    const stopReason = choice?.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice?.finish_reason === 'length'
      ? 'max_tokens'
      : 'end_turn';
    yield { type: 'done', stopReason };
  }
}

/** Mistral, unchanged in behaviour from when this was `mistral.ts`. */
export class MistralAdapter extends OpenAiCompatibleAdapter {
  constructor(models: string | string[], apiKey: string) {
    super(models, apiKey, { baseUrl: 'https://api.mistral.ai/v1', label: 'Mistral' });
  }
}

/**
 * Groq's default fallback chain, in order.
 *
 * **Every entry was verified against this account's own `/openai/v1/models`
 * and then sent a real tool-calling request. None of it came from Groq's
 * documentation, which is wrong about this account in three separate ways:**
 * it lists `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` as production
 * models (neither exists here), and its tool-use page lists `groq/compound`
 * and `groq/compound-mini` (both answer "`tool calling` is not supported with
 * this model"). Re-verify the same way before editing this list — the agent
 * loop is useless without tool calling, and a model that cannot do it fails
 * every turn rather than falling back.
 *
 * The order is capability first, then a deliberate change of family: if
 * OpenAI's open-weights models are having a bad hour on Groq's side, a third
 * `gpt-oss` variant is not a fallback, so Qwen sits at the end.
 *
 * Excluded on purpose, all verified: `qwen/qwen3.6-27b` (free tier's
 * per-request token allowance for it is below even a trivial request — it
 * answers `rate_limit_exceeded: Request too large`), and
 * `openai/gpt-oss-safeguard-20b`, which *can* tool-call but is a safety
 * classifier and has no business holding a conversation with a renter.
 */
export const GROQ_DEFAULT_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

/**
 * Groq, on their OpenAI-compatible endpoint.
 *
 * The base URL is `/openai/v1` and not `/v1` — Groq serves its native API at
 * the latter, and pointing this there gets a 404 rather than anything that
 * reads like a configuration mistake.
 */
export class GroqAdapter extends OpenAiCompatibleAdapter {
  constructor(models: string | string[], apiKey: string) {
    super(models, apiKey, { baseUrl: 'https://api.groq.com/openai/v1', label: 'Groq' });
  }
}
