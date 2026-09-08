// AutoHire — ai-agent Mistral adapter.
//
// Ported from `ai-search/index.ts` so the MISTRAL_API_KEY already set for
// that function keeps working here: plain `fetch` against Mistral's REST API
// (OpenAI-shaped tool calling — `{type:'function', function:{name,
// description, parameters}}`), no SDK, same reasoning as the original —
// one less npm dependency for the Deno runtime to resolve.
//
// Not token-streamed: Mistral's SSE chunk format for interleaved text +
// tool-call deltas isn't documented in the same request/response reference
// ai-search was built from, and a wrong guess here would silently corrupt
// tool-call JSON. This does one non-streaming request per turn and replays
// the full text as a single `text_delta` — `loop.ts` and the SSE layer don't
// care whether text arrived in one chunk or many, so nothing upstream
// changes; the renter/host just sees that turn's text land in one write
// instead of a token-by-token trickle.

import type { AdapterEvent, ChatMessage, CompleteParams, ProviderAdapter, ToolSpec } from './adapter.ts';

interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MistralMessage {
  role: string;
  content?: string | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface MistralResponse {
  choices?: { message?: MistralMessage; finish_reason?: string }[];
}

function toMistralTools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/**
 * Mistral's wire format is OpenAI-shaped: tool_use/tool_result don't exist as
 * such — a tool call is an assistant message with `tool_calls`, and its
 * result is a separate `role: 'tool'` message keyed by `tool_call_id`. This
 * flattens our provider-neutral ChatMessage[] into that shape, merging a
 * `tool_use` + `tool_result` pair that our internal format keeps as two
 * message parts (Anthropic's shape) into Mistral's two separate messages.
 */
function toMistralMessages(messages: ChatMessage[]): MistralMessage[] {
  const out: MistralMessage[] = [];
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

export class MistralAdapter implements ProviderAdapter {
  constructor(private readonly model: string, private readonly apiKey: string) {}

  async *complete(params: CompleteParams): AsyncGenerator<AdapterEvent> {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: params.system }, ...toMistralMessages(params.messages)],
        tools: toMistralTools(params.tools),
        tool_choice: 'auto',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      yield { type: 'done', stopReason: 'error', error: `Mistral API error ${res.status}: ${errText}` };
      return;
    }

    const data = (await res.json()) as MistralResponse;
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
