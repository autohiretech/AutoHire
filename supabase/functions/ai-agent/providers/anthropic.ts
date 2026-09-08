// AutoHire — ai-agent Anthropic adapter (default provider).
//
// Manual streaming loop, not the SDK's tool-runner helper — the tool-runner
// is a beta convenience that owns the whole call/execute/resend cycle itself,
// which would fight `loop.ts` doing exactly that (it needs to inspect every
// tool call before it runs, to gate `money`/`destructive` tools on a confirm
// token). `client.messages.stream()` + `finalMessage()` gives token-by-token
// text for the SSE `say` events while still handing back fully-parsed
// `tool_use` blocks (no manual partial-JSON accumulation) — see
// typescript/claude-api/tool-use.md → Manual Agentic Loop /
// typescript/claude-api/streaming.md in the claude-api skill.
//
// Model shapes here (tool_use, input_schema, stream event types) are taken
// from that skill, not guessed.

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import type { AdapterEvent, ChatMessage, CompleteParams, MessagePart, ProviderAdapter, ToolSpec } from './adapter.ts';

function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.parts.map((p: MessagePart): Anthropic.ContentBlockParam => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'tool_use') return { type: 'tool_use', id: p.id, name: p.name, input: p.input as Record<string, unknown> };
      return { type: 'tool_result', tool_use_id: p.toolUseId, content: p.content, is_error: p.isError };
    }),
  }));
}

export class AnthropicAdapter implements ProviderAdapter {
  constructor(private readonly model: string, private readonly client: Anthropic = new Anthropic()) {}

  async *complete(params: CompleteParams): AsyncGenerator<AdapterEvent> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      tools: toAnthropicTools(params.tools),
    });

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }
    } catch (err) {
      yield { type: 'done', stopReason: 'error', error: err instanceof Error ? err.message : String(err) };
      return;
    }

    const message = await stream.finalMessage();
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        yield { type: 'tool_call', id: block.id, name: block.name, input: block.input };
      }
    }

    if (message.stop_reason === 'refusal') {
      yield { type: 'done', stopReason: 'error', error: 'The model declined to continue with this request.' };
      return;
    }
    const stopReason = message.stop_reason === 'tool_use'
      ? 'tool_use'
      : message.stop_reason === 'max_tokens'
      ? 'max_tokens'
      : 'end_turn';
    yield { type: 'done', stopReason };
  }
}
