import { assert, assertEquals } from 'jsr:@std/assert@^1.0.0';
import { runLoop } from '../loop.ts';
import type { LoopEvent, ToolLogEntry } from '../loop.ts';
import { InMemoryTokenLedger, signConfirmToken } from '../confirm.ts';
import { fakeCtx, fakeTool, ScriptedProvider, textTurn, toolCallTurn } from './helpers.ts';

const SECRET = 'test-secret';

async function collect(gen: AsyncGenerator<LoopEvent>): Promise<LoopEvent[]> {
  const out: LoopEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

Deno.test('loop chains read -> write -> final say', async () => {
  const readTool = fakeTool({ name: 'read_thing', effect: 'read' });
  const writeTool = fakeTool({ name: 'do_thing', effect: 'write' });
  const provider = new ScriptedProvider([
    toolCallTurn('c1', 'read_thing', { a: 1 }),
    toolCallTurn('c2', 'do_thing', { b: 2 }),
    textTurn('All done.'),
  ]);

  const events = await collect(runLoop({
    provider,
    tools: [readTool, writeTool],
    ctx: fakeCtx(),
    systemPrompt: 'sys',
    message: 'do the thing',
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
  }));

  assertEquals(readTool.calls.length, 1);
  assertEquals(writeTool.calls.length, 1);
  const steps = events.filter((e) => e.type === 'step');
  assertEquals(steps.map((s) => (s as { tool: string }).tool), ['read_thing', 'do_thing']);
  const says = events.filter((e) => e.type === 'say');
  assertEquals(says.length, 1);
  assertEquals((says[0] as { text: string }).text, 'All done.');
});

Deno.test('a money tool without a confirm token yields confirm and never runs', async () => {
  const payTool = fakeTool({ name: 'pay_thing', effect: 'money' });
  const provider = new ScriptedProvider([toolCallTurn('c1', 'pay_thing', { amount: 100 })]);

  const events = await collect(runLoop({
    provider,
    tools: [payTool],
    ctx: fakeCtx(),
    systemPrompt: 'sys',
    message: 'pay for it',
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
  }));

  assertEquals(payTool.calls.length, 0, 'run() must not execute on the first ask');
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'action');
  const action = (events[0] as { action: Record<string, unknown> }).action;
  assertEquals(action.type, 'confirm');
  assert(typeof action.token === 'string' && action.token.length > 0);
  assert(typeof action.summary === 'string');
});

Deno.test('a destructive tool with a valid confirm token runs exactly once', async () => {
  const cancelTool = fakeTool({ name: 'cancel_thing', effect: 'destructive', run: () => Promise.resolve({ cancelled: true }) });
  const ledger = new InMemoryTokenLedger();
  const { token } = await signConfirmToken({ userId: 'user-1', tool: 'cancel_thing', input: { id: 'b1' } }, SECRET);

  const provider = new ScriptedProvider([textTurn('Cancelled it.')]);
  const events = await collect(runLoop({
    provider,
    tools: [cancelTool],
    ctx: fakeCtx(),
    systemPrompt: 'sys',
    message: 'yes, cancel it',
    confirmToken: token,
    confirmSecret: SECRET,
    tokenLedger: ledger,
  }));

  assertEquals(cancelTool.calls.length, 1);
  assertEquals(cancelTool.calls[0], { id: 'b1' });
  const steps = events.filter((e) => e.type === 'step');
  assertEquals(steps.length, 1);
  assertEquals((steps[0] as { tool: string }).tool, 'cancel_thing');
});

Deno.test('a reused confirm token is refused on the second attempt', async () => {
  const cancelTool = fakeTool({ name: 'cancel_thing', effect: 'destructive' });
  const ledger = new InMemoryTokenLedger();
  const { token } = await signConfirmToken({ userId: 'user-1', tool: 'cancel_thing', input: { id: 'b1' } }, SECRET);

  const runOnce = () =>
    collect(runLoop({
      provider: new ScriptedProvider([textTurn('ok')]),
      tools: [cancelTool],
      ctx: fakeCtx(),
      systemPrompt: 'sys',
      message: 'yes, cancel it',
      confirmToken: token,
      confirmSecret: SECRET,
      tokenLedger: ledger,
    }));

  await runOnce();
  const second = await runOnce();

  assertEquals(cancelTool.calls.length, 1, 'the tool must not run a second time');
  assertEquals(second.length, 1);
  assertEquals(second[0].type, 'error');
  assert((second[0] as { message: string }).message.toLowerCase().includes('already been used'));
});

Deno.test('an expired confirm token is refused', async () => {
  const cancelTool = fakeTool({ name: 'cancel_thing', effect: 'destructive' });
  const { token } = await signConfirmToken({ userId: 'user-1', tool: 'cancel_thing', input: { id: 'b1' }, ttlSeconds: -1 }, SECRET);

  const events = await collect(runLoop({
    provider: new ScriptedProvider([textTurn('ok')]),
    tools: [cancelTool],
    ctx: fakeCtx(),
    systemPrompt: 'sys',
    message: 'yes, cancel it',
    confirmToken: token,
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
  }));

  assertEquals(cancelTool.calls.length, 0);
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'error');
  assert((events[0] as { message: string }).message.toLowerCase().includes('expired'));
});

Deno.test('a confirm token cannot be redeemed by a different user than it was signed for', async () => {
  const cancelTool = fakeTool({ name: 'cancel_thing', effect: 'destructive' });
  const { token } = await signConfirmToken({ userId: 'user-1', tool: 'cancel_thing', input: { id: 'b1' } }, SECRET);

  const events = await collect(runLoop({
    provider: new ScriptedProvider([textTurn('ok')]),
    tools: [cancelTool],
    ctx: fakeCtx({ userId: 'user-2' }),
    systemPrompt: 'sys',
    message: 'yes, cancel it',
    confirmToken: token,
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
  }));

  assertEquals(cancelTool.calls.length, 0);
  assertEquals(events[0].type, 'error');
});

Deno.test('scope enforcement: a host-only tool is invisible to a renter and refused if called anyway', async () => {
  const hostTool = fakeTool({ name: 'host_only_thing', scope: 'host', effect: 'write' });
  const log: ToolLogEntry[] = [];
  const provider = new ScriptedProvider([
    toolCallTurn('c1', 'host_only_thing', {}),
    textTurn('sorry, cannot do that'),
  ]);

  const events = await collect(runLoop({
    provider,
    tools: [hostTool],
    ctx: fakeCtx({ role: 'renter' }),
    systemPrompt: 'sys',
    message: 'do the host thing',
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
    onToolLog: (entries) => {
      log.push(...entries);
    },
  }));

  assertEquals(hostTool.calls.length, 0);
  // The tool wasn't offered to the model at all, so the provider never even
  // saw it in its tool list.
  assertEquals(provider.calls[0].tools.find((t) => t.name === 'host_only_thing'), undefined);
  assert(log.some((e) => e.error === 'unknown tool'));
  assert(events.some((e) => e.type === 'say'));
});

Deno.test('a tool result shaped { action } is surfaced as an SSE action event', async () => {
  const navTool = fakeTool({
    name: 'navigate',
    effect: 'write',
    run: () => Promise.resolve({ action: { type: 'navigate', route: '/watchlist' } }),
  });
  const provider = new ScriptedProvider([toolCallTurn('c1', 'navigate', { route: '/watchlist' }), textTurn('Here you go.')]);

  const events = await collect(runLoop({
    provider,
    tools: [navTool],
    ctx: fakeCtx(),
    systemPrompt: 'sys',
    message: 'take me to my watchlist',
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
  }));

  const action = events.find((e) => e.type === 'action');
  assert(action);
  assertEquals((action as { action: Record<string, unknown> }).action, { type: 'navigate', route: '/watchlist' });
});

Deno.test('the model can end a turn with chips parsed from its own trailing CHIPS: line', async () => {
  const provider = new ScriptedProvider([textTurn('Sure thing.\nCHIPS: My trips => show my trips | Search again => search cars')]);
  const events = await collect(runLoop({
    provider,
    tools: [],
    ctx: fakeCtx(),
    systemPrompt: 'sys',
    message: 'thanks',
    confirmSecret: SECRET,
    tokenLedger: new InMemoryTokenLedger(),
  }));

  const say = events.find((e) => e.type === 'say');
  assertEquals((say as { text: string }).text, 'Sure thing.');
  const chips = events.find((e) => e.type === 'chips');
  assert(chips);
  assertEquals((chips as { chips: { label: string; send: string }[] }).chips, [
    { label: 'My trips', send: 'show my trips' },
    { label: 'Search again', send: 'search cars' },
  ]);
});
