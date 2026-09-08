// AutoHire — ai-agent SSE framing. Split out from index.ts so it's testable
// without touching `Deno.serve` (importing index.ts for its side effect of
// starting a listener is exactly what a unit test must not do).

/** One `event: <name>\ndata: <json>\n\n` frame, per the SSE spec — a blank line ends the event. */
export function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};
