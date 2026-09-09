// AutoHire — ai-agent provider adapter.
//
// One interface both `anthropic.ts` and `openai-compatible.ts` implement, so `loop.ts`
// never branches on which model is talking. The shape is deliberately
// smaller than either vendor's own message format — just enough to carry a
// turn of text/tool-use/tool-result — and each adapter translates to/from
// its own wire shape at the edges.

export type ChatRole = 'user' | 'assistant';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  /** Always a string — tool results are serialized (JSON.stringify'd if structured) before they reach the adapter. */
  content: string;
  isError?: boolean;
}

export type MessagePart = TextPart | ToolUsePart | ToolResultPart;

export interface ChatMessage {
  role: ChatRole;
  parts: MessagePart[];
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export type AdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'; error?: string };

export interface CompleteParams {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

export interface ProviderAdapter {
  /** One model turn. Yields text as it's produced, then any tool calls, then exactly one `done`. */
  complete(params: CompleteParams): AsyncGenerator<AdapterEvent>;
}
