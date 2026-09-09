import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { parseInline, renderInline, visibleLength } from '@/lib/inlineMarkdown';

/**
 * The agent's turn history, over the map.
 *
 * `ResearchField` deliberately never kept one — its own header says the line
 * is "replaced, not appended to, on every turn" — which is right for a status
 * line and wrong for an answer. A renter who asked "what's cheapest near the
 * airport" got a sentence that vanished the moment the next turn started
 * saying "Searching…", and on a page whose whole job is answering questions
 * about the cars on screen, the answer was the one thing that didn't stay.
 *
 * So this is additive rather than a replacement: the field keeps its single
 * live line (steps, "Thinking…", the error that leaves the text as typed),
 * and what accumulates here is only the conversation — what the renter asked
 * and what the agent actually said back.
 */

export type ChatRole = 'user' | 'ai';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** An `error` event rather than a `say` — same bubble, different colour, so
   * a failure doesn't read as the assistant's considered answer. */
  tone?: 'error';
}

const SOUND_KEY = 'autohire-ai-sound';

/** Off unless the renter turned it on. A chime on every reply is the kind of
 * thing that delights once and irritates for the rest of the session, and
 * browsers block audio before a gesture anyway — so the animation carries the
 * life and sound is an accent somebody opts into. */
function loadSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Two soft notes, synthesised rather than fetched.
 *
 * An asset would be a network request and a file to ship for something this
 * small, and `AudioContext` is created lazily on the first play so a renter
 * who never enables sound never constructs one. Wrapped because Safari throws
 * rather than no-ops when audio is disallowed, and a failed chime must never
 * take a reply down with it.
 */
let audioCtx: AudioContext | null = null;
function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();

    [880, 1174.7].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.09;
      // A short bell-ish envelope. Peak is deliberately low — this sits under
      // whatever the renter is already listening to, not over it.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // No audio available. Nothing to recover — the reply is already on screen.
  }
}

/**
 * Reveals the newest assistant message a character at a time.
 *
 * The agent sends `say` as one finished string, not a token stream, so there
 * is nothing genuinely incremental to render — this is a deliberate piece of
 * theatre and worth naming as such. It earns its place because a sentence
 * that appears all at once beside a map that just moved reads as a page
 * refresh, and one that types reads as an answer.
 *
 * Only ever the latest message, and only when it is new: a restored
 * conversation renders whole, or every reload would replay the whole history
 * like a cutscene nobody can skip.
 */
function useTypewriter(total: number, enabled: boolean): number {
  const [shown, setShown] = useState(enabled ? 0 : total);

  useEffect(() => {
    if (!enabled) {
      setShown(total);
      return;
    }
    setShown(0);
    let i = 0;
    // Fast enough to never be the thing a renter is waiting on: a 120-word
    // answer lands in about two seconds.
    const step = Math.max(1, Math.ceil(total / 90));
    const id = window.setInterval(() => {
      i += step;
      setShown(i);
      if (i >= total) window.clearInterval(id);
    }, 22);
    return () => window.clearInterval(id);
  }, [total, enabled]);

  return shown;
}

function Bubble({ message, animate }: { message: ChatMessage; animate: boolean }) {
  const isUser = message.role === 'user';
  // The renter's own words are shown exactly as typed — parsing them would
  // mean a question containing an asterisk came back looking edited.
  const segments = useMemo(
    () => (isUser ? [{ text: message.text }] : parseInline(message.text)),
    [message.text, isUser],
  );
  const total = useMemo(() => visibleLength(segments), [segments]);
  const shown = useTypewriter(total, animate && !isUser);

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'animate-chat-in max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-card)] px-3 py-2 text-body-sm',
          isUser
            ? 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
            : message.tone === 'error'
              ? 'bg-[var(--color-danger-tint)] text-[var(--color-content)]'
              : 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]',
        )}
      >
        {renderInline(segments, animate && !isUser ? shown : undefined)}
        {/* A caret only while there is still text to come, so a finished
            answer doesn't sit there blinking as though it were still going. */}
        {!isUser && animate && shown < total && (
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--color-content-muted)]" />
        )}
      </div>
    </div>
  );
}

export function AiChat({
  messages,
  busy,
  className,
}: {
  messages: ChatMessage[];
  /** A turn is in flight — shows the thinking dots under the last bubble. */
  busy?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [sound, setSound] = useState(loadSoundPref);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Which message ids existed on mount. Those render whole; anything that
  // arrives afterwards is new and gets typed. Without this a restored
  // conversation would animate on every navigation back to /ai.
  const seenRef = useRef<Set<string>>(new Set(messages.map((m) => m.id)));
  const lastSoundedRef = useRef<string | null>(null);

  const last = messages[messages.length - 1];

  useEffect(() => {
    if (!last || last.role !== 'ai') return;
    if (seenRef.current.has(last.id)) return;
    if (lastSoundedRef.current === last.id) return;
    lastSoundedRef.current = last.id;
    if (sound) chime();
  }, [last, sound]);

  // Pin to the newest message. `behavior: 'smooth'` on every character of a
  // typing bubble would fight itself, so this runs on message count and on
  // the busy flag rather than on content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy, collapsed]);

  if (messages.length === 0) return null;

  const reduced = prefersReducedMotion();

  return (
    <div
      className={cn(
        'pointer-events-auto flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <Sparkles size={14} className={cn('text-[var(--color-accent-on)]', busy && 'animate-ai-glow')} />
        <p className="flex-1 text-body-sm font-semibold text-[var(--color-content)]">Assistant</p>
        <button
          type="button"
          onClick={() => {
            const next = !sound;
            setSound(next);
            try {
              localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
            } catch {
              // Private mode — the toggle still holds for this page view.
            }
            // Play on enable, both as confirmation and because this click is
            // the gesture that lets the browser start an AudioContext at all.
            if (next) chime();
          }}
          aria-label={sound ? 'Turn reply sound off' : 'Turn reply sound on'}
          aria-pressed={sound}
          className="rounded-[var(--radius-control)] p-1 text-[var(--color-content-subtle)] hover:text-[var(--color-content)]"
        >
          {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        {/* Collapse only — never a clear. A chevron reads as "minimise", and
            wiring it to discard the conversation meant one tap silently threw
            away everything the renter had asked. Forgetting the conversation
            is "Start over" in the field, which drops the agent's session at
            the same time; this just gets the panel out of the way of the map. */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Show the conversation' : 'Hide the conversation'}
          className="rounded-[var(--radius-control)] p-1 text-[var(--color-content-subtle)] hover:text-[var(--color-content)]"
        >
          <ChevronDown size={16} className={cn('transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>

      {!collapsed && (
        // `min-h-0` so this actually scrolls inside a height-capped flex
        // column instead of growing the card past its own max-height.
        <div ref={scrollRef} className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
          {messages.map((m) => (
            <Bubble key={m.id} message={m} animate={!reduced && !seenRef.current.has(m.id)} />
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-content-subtle)]"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
