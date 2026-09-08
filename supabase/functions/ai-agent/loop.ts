// AutoHire — ai-agent turn loop: model → tool → result → model, up to 8
// steps, emitting each step as it happens. See the file header of
// confirm.ts for the token-gate design this leans on.

import type { ChatMessage, MessagePart, ProviderAdapter, ToolSpec } from './providers/adapter.ts';
import { signConfirmToken, tokenAuthorizes, verifyConfirmToken } from './confirm.ts';
import type { TokenLedger } from './confirm.ts';
import { scopeAllows } from './tools/types.ts';
import type { ToolCtx, ToolDef } from './tools/types.ts';

export type Chip = { label: string; send: string };

export type LoopEvent =
  | { type: 'step'; tool: string; summary: string }
  | { type: 'action'; action: Record<string, unknown> & { type: string } }
  | { type: 'say'; text: string }
  | { type: 'chips'; chips: Chip[] }
  | { type: 'error'; message: string };

export interface ToolLogEntry {
  tool: string;
  input: unknown;
  result?: unknown;
  error?: string;
  /** Set on the one entry that recorded a confirm-token grant, not an execution. */
  confirmJti?: string;
}

export interface RunLoopParams {
  provider: ProviderAdapter;
  tools: ToolDef[];
  ctx: ToolCtx;
  systemPrompt: string;
  message: string;
  confirmToken?: string;
  confirmSecret: string;
  tokenLedger: TokenLedger;
  /** Earlier turns of this session, oldest first, so a follow-up ("make it
   * cheaper", "the second one", "what about next weekend") resolves against
   * what was already said. Without this every turn arrives cold and the
   * pronouns in a follow-up refer to nothing. The caller decides how far
   * back to go; the loop just replays what it is given. */
  history?: ChatMessage[];
  maxSteps?: number;
  /** Every tool call this turn made (successful, errored, or confirm-pending) — the caller persists this as `ai_turns.tool_log`. */
  onToolLog?: (entries: ToolLogEntry[]) => void;
}

const MAX_STEPS_DEFAULT = 8;
const SAY_MAX_CHARS = 120;

function toolSpecsFor(tools: ToolDef[]): ToolSpec[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

/** A tool result shaped `{ action: {...} }` becomes an SSE `action` event — see tools/actions.ts's file comment. */
function actionFromResult(result: unknown): (Record<string, unknown> & { type: string }) | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const action = (result as Record<string, unknown>).action;
  if (action && typeof action === 'object' && typeof (action as Record<string, unknown>).type === 'string') {
    return action as Record<string, unknown> & { type: string };
  }
  return undefined;
}

/** Pulls the trailing `CHIPS: Label => send | Label => send` line the prompt asks the model for, if present. */
export function parseChips(text: string): { text: string; chips: Chip[] } {
  const lines = text.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const match = last.match(/^\s*CHIPS:\s*(.+)$/i);
  if (!match) return { text: text.trim(), chips: [] };
  const chips: Chip[] = match[1]
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [label, send] = part.split('=>').map((s) => s.trim());
      return { label: label || part, send: send || label || part };
    })
    .slice(0, 3);
  return { text: lines.slice(0, -1).join('\n').trim(), chips };
}

function say(text: string): LoopEvent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const oneLine = trimmed.split('\n')[0].slice(0, SAY_MAX_CHARS);
  return [{ type: 'say', text: oneLine }];
}

export async function* runLoop(params: RunLoopParams): AsyncGenerator<LoopEvent> {
  const { provider, ctx, systemPrompt, confirmSecret, tokenLedger } = params;
  const maxSteps = params.maxSteps ?? MAX_STEPS_DEFAULT;
  const tools = params.tools.filter((t) => scopeAllows(t.scope, ctx.role));
  const toolLog: ToolLogEntry[] = [];
  const finish = () => params.onToolLog?.(toolLog);

  const messages: ChatMessage[] = [
    ...(params.history ?? []),
    { role: 'user', parts: [{ type: 'text', text: params.message }] },
  ];

  // --- Confirmed money/destructive execution, if this request carries one ---
  // Runs BEFORE any model call: the token already encodes exactly which tool
  // and input it authorizes, so there's nothing left for the model to decide.
  if (params.confirmToken) {
    const verified = await verifyConfirmToken(params.confirmToken, confirmSecret);
    if (!verified.ok) {
      yield { type: 'error', message: verified.reason === 'expired' ? 'That confirmation expired — ask again to get a new one.' : 'That confirmation is invalid — ask again to get a new one.' };
      finish();
      return;
    }
    const { claims } = verified;
    if (claims.sub !== ctx.userId) {
      yield { type: 'error', message: 'That confirmation is invalid — ask again to get a new one.' };
      finish();
      return;
    }
    if (await tokenLedger.wasConsumed(claims.jti)) {
      yield { type: 'error', message: 'That confirmation has already been used.' };
      finish();
      return;
    }
    const tool = tools.find((t) => t.name === claims.tool);
    if (!tool) {
      yield { type: 'error', message: "That action isn't available." };
      finish();
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(claims.input);
    } catch {
      yield { type: 'error', message: 'That confirmation is invalid — ask again to get a new one.' };
      finish();
      return;
    }
    if (!tokenAuthorizes(claims, { userId: ctx.userId, tool: tool.name, input })) {
      yield { type: 'error', message: 'That confirmation is invalid — ask again to get a new one.' };
      finish();
      return;
    }

    let result: unknown;
    try {
      result = await tool.run(ctx, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLog.push({ tool: tool.name, input, error: message });
      yield { type: 'error', message };
      finish();
      return;
    }
    await tokenLedger.consume(claims.jti);
    toolLog.push({ tool: tool.name, input, result });
    yield { type: 'step', tool: tool.name, summary: tool.summary(input, result) };
    const action = actionFromResult(result);
    if (action) yield { type: 'action', action };

    // Synthetic tool_use/tool_result pair so the model can react (a `say`,
    // maybe chips) — there was no real model-issued tool_use this request to
    // pair the result against, since we skipped straight to execution.
    messages.push({ role: 'assistant', parts: [{ type: 'tool_use', id: 'confirmed', name: tool.name, input }] });
    messages.push({ role: 'user', parts: [{ type: 'tool_result', toolUseId: 'confirmed', content: safeJson(result) }] });
  }

  for (let step = 0; step < maxSteps; step++) {
    let turnText = '';
    let providerError: string | undefined;
    const toolCalls: { id: string; name: string; input: unknown }[] = [];

    for await (const event of provider.complete({ system: systemPrompt, messages, tools: toolSpecsFor(tools) })) {
      if (event.type === 'text_delta') turnText += event.text;
      else if (event.type === 'tool_call') toolCalls.push(event);
      else if (event.type === 'done' && event.stopReason === 'error') providerError = event.error ?? 'The assistant had a problem responding.';
    }

    if (providerError) {
      yield { type: 'error', message: providerError };
      finish();
      return;
    }

    if (toolCalls.length === 0) {
      const { text, chips } = parseChips(turnText);
      for (const ev of say(text)) yield ev;
      if (chips.length > 0) yield { type: 'chips', chips };
      finish();
      return;
    }

    const assistantParts: MessagePart[] = [];
    if (turnText.trim()) assistantParts.push({ type: 'text', text: turnText });
    for (const call of toolCalls) assistantParts.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
    messages.push({ role: 'assistant', parts: assistantParts });

    const resultParts: MessagePart[] = [];
    let stoppedForConfirm = false;

    for (const call of toolCalls) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        resultParts.push({ type: 'tool_result', toolUseId: call.id, content: `Unknown tool "${call.name}".`, isError: true });
        toolLog.push({ tool: call.name, input: call.input, error: 'unknown tool' });
        continue;
      }

      if (tool.effect === 'money' || tool.effect === 'destructive') {
        const signed = await signConfirmToken({ userId: ctx.userId, tool: tool.name, input: call.input }, confirmSecret);
        toolLog.push({ tool: tool.name, input: call.input, confirmJti: signed.jti });
        yield {
          type: 'action',
          action: { type: 'confirm', summary: tool.summary(call.input, undefined), token: signed.token },
        };
        stoppedForConfirm = true;
        break;
      }

      try {
        const result = await tool.run(ctx, call.input);
        toolLog.push({ tool: tool.name, input: call.input, result });
        yield { type: 'step', tool: tool.name, summary: tool.summary(call.input, result) };
        const action = actionFromResult(result);
        if (action) yield { type: 'action', action };
        resultParts.push({ type: 'tool_result', toolUseId: call.id, content: safeJson(result) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolLog.push({ tool: tool.name, input: call.input, error: message });
        resultParts.push({ type: 'tool_result', toolUseId: call.id, content: message, isError: true });
      }
    }

    // A money/destructive tool ends the turn outright — no further model
    // round trip this request, per the guardrail: it never runs on the
    // request that first asks for it, confirmed or not yet resolved.
    if (stoppedForConfirm) {
      finish();
      return;
    }

    messages.push({ role: 'user', parts: resultParts });
  }

  yield { type: 'say', text: "That's more steps than expected — try narrowing the request." };
  finish();
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}
