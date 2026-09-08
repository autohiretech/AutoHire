import { assertEquals } from 'jsr:@std/assert@^1.0.0';
import { sseLine } from '../sse.ts';

Deno.test('sseLine frames one SSE event: "event: <name>\\ndata: <json>\\n\\n"', () => {
  const frame = sseLine('step', { tool: 'list_listings', summary: 'Searching listings' });
  assertEquals(frame, 'event: step\ndata: {"tool":"list_listings","summary":"Searching listings"}\n\n');
  // Exactly one blank line terminates the event — required for a browser
  // EventSource (and the SSE parser the client presumably already has from
  // any other streaming endpoint) to dispatch it instead of buffering
  // forever waiting for more of the same event.
  assertEquals(frame.endsWith('\n\n'), true);
  assertEquals(frame.slice(0, -2).includes('\n\n'), false);
});

Deno.test('sseLine handles every documented event/payload shape', () => {
  const cases: [string, unknown][] = [
    ['action', { type: 'navigate', route: '/watchlist' }],
    ['action', { type: 'confirm', summary: 'Cancel booking b1', token: 'abc.def' }],
    ['say', { text: 'Done.' }],
    ['chips', [{ label: 'My trips', send: 'show my trips' }]],
    ['done', { sessionId: 'aisess-1' }],
    ['error', { message: 'Something went wrong.' }],
  ];
  for (const [event, data] of cases) {
    const frame = sseLine(event, data);
    assertEquals(frame, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
});
