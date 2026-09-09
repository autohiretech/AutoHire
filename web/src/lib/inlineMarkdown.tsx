import type { ReactNode } from 'react';

/**
 * The little bit of Markdown the model actually emits, rendered rather than
 * printed.
 *
 * `ai-agent` prompts produce ordinary prose with the occasional `**emphasis**`
 * — nothing asked it to and nothing stops it, because it is a language model
 * writing English. Rendering that raw put literal asterisks in front of the
 * host ("As an **owner**, your earnings come from…"), which reads as a bug in
 * the product rather than a quirk of the writer.
 *
 * Deliberately *inline* and deliberately tiny: bold, italic and code spans,
 * and nothing else. No links, no headings, no lists, no HTML — a full Markdown
 * renderer here would be a dependency and an injection surface for the one
 * thing on this page written by something other than us, to solve a problem
 * that is four characters wide. Anything it does not recognise is left exactly
 * as written, so an unmatched `*` shows up as an asterisk rather than
 * swallowing the rest of the sentence.
 */

export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

// `**bold**` before `*italic*` so the two-star form wins; `` `code` `` is
// matched first because its contents must not be re-parsed.
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;

export function parseInline(input: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;

  for (const m of input.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: input.slice(last, at) });

    const tok = m[0];
    if (tok.startsWith('`')) out.push({ text: tok.slice(1, -1), code: true });
    else if (tok.startsWith('**')) out.push({ text: tok.slice(2, -2), bold: true });
    else out.push({ text: tok.slice(1, -1), italic: true });

    last = at + tok.length;
  }

  if (last < input.length) out.push({ text: input.slice(last) });
  return out;
}

/**
 * Render segments, optionally revealing only the first `limit` characters.
 *
 * The limit counts *visible* characters, not source ones, which is the whole
 * reason the typewriter reveals through here rather than slicing the raw
 * string: slicing `**owner**` at four characters shows `**ow`, so the effect
 * that was supposed to make an answer feel alive would flash the markup on
 * every reply instead.
 */
export function renderInline(segments: Segment[], limit?: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let used = 0;

  segments.forEach((seg, i) => {
    if (limit !== undefined && used >= limit) return;

    const text =
      limit === undefined ? seg.text : seg.text.slice(0, Math.max(0, limit - used));
    used += text.length;
    if (!text) return;

    if (seg.code) {
      nodes.push(
        <code key={i} className="rounded bg-[var(--color-surface-sunken)] px-1 font-mono text-[0.9em]">
          {text}
        </code>,
      );
    } else if (seg.bold) {
      nodes.push(
        <strong key={i} className="font-semibold">
          {text}
        </strong>,
      );
    } else if (seg.italic) {
      nodes.push(<em key={i}>{text}</em>);
    } else {
      nodes.push(<span key={i}>{text}</span>);
    }
  });

  return nodes;
}

/** Total visible length — what the typewriter counts up to. */
export function visibleLength(segments: Segment[]): number {
  return segments.reduce((n, s) => n + s.text.length, 0);
}
