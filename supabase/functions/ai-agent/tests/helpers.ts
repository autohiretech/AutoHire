// AutoHire — ai-agent test helpers: a scripted fake provider + minimal fake
// tools, so loop.ts's guardrails can be exercised without a real model or a
// real Supabase project.

import type { AdapterEvent, CompleteParams, ProviderAdapter } from '../providers/adapter.ts';
import type { Effect, Scope, ToolCtx, ToolDef } from '../tools/types.ts';

/** Each element is the full event sequence for one `complete()` call — the Nth call to the loop gets the Nth script entry (or a bare `end_turn` if it runs out). */
export class ScriptedProvider implements ProviderAdapter {
  calls: CompleteParams[] = [];
  private turn = 0;
  constructor(private readonly script: AdapterEvent[][]) {}

  async *complete(params: CompleteParams): AsyncGenerator<AdapterEvent> {
    this.calls.push(params);
    const events = this.script[this.turn++] ?? [{ type: 'done', stopReason: 'end_turn' } as AdapterEvent];
    for (const e of events) yield e;
  }
}

export function textTurn(text: string): AdapterEvent[] {
  return [{ type: 'text_delta', text }, { type: 'done', stopReason: 'end_turn' }];
}

export function toolCallTurn(id: string, name: string, input: unknown): AdapterEvent[] {
  return [{ type: 'tool_call', id, name, input }, { type: 'done', stopReason: 'tool_use' }];
}

export function fakeTool(opts: {
  name: string;
  scope?: Scope;
  effect?: Effect;
  run?: (ctx: ToolCtx, input: unknown) => Promise<unknown>;
}): ToolDef & { calls: unknown[] } {
  const calls: unknown[] = [];
  const tool: ToolDef & { calls: unknown[] } = {
    name: opts.name,
    description: `test tool ${opts.name}`,
    input_schema: { type: 'object', properties: {} },
    scope: opts.scope ?? 'any',
    effect: opts.effect ?? 'read',
    summary: (input) => `did ${opts.name} with ${JSON.stringify(input)}`,
    async run(ctx, input) {
      calls.push(input);
      return opts.run ? await opts.run(ctx, input) : { ok: true };
    },
    calls,
  };
  return tool;
}

export function fakeCtx(overrides: Partial<ToolCtx> = {}): ToolCtx {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1',
    role: 'renter',
    ...overrides,
  };
}
