import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { streamAgentTurn, type AgentAction, type AgentChip } from '@/lib/aiAgent';
import { Chip, ChipRow, Spinner, toast } from '@/components/ui';
import { cn } from '@/lib/cn';

const CONVO_KEY = 'autohire-host-ai-convo';

interface Line {
  text: string;
  tone: 'status' | 'question' | 'error';
}
interface ConfirmState {
  summary: string;
  token: string;
}
interface StoredConvo {
  sessionId: string | null;
  line: Line | null;
  chips: AgentChip[];
  confirm: ConfirmState | null;
  lastMessage: string | null;
}

const EMPTY_CONVO: StoredConvo = { sessionId: null, line: null, chips: [], confirm: null, lastMessage: null };

function loadConvo(): StoredConvo {
  try {
    const raw = sessionStorage.getItem(CONVO_KEY);
    if (!raw) return EMPTY_CONVO;
    return { ...EMPTY_CONVO, ...(JSON.parse(raw) as Partial<StoredConvo>) };
  } catch {
    return EMPTY_CONVO;
  }
}

/**
 * The host's own AI field — the same `ai-agent` turn machinery as the
 * renter's `ResearchField` (one line, one row of chips, never a thread), but
 * without any of what that component carries for shopping: no `SearchBar`
 * (a host has no "where/from/until" to fill in), no `filters`/`onHighlight`
 * (there's no result list here to filter), no booking prompt.
 *
 * What a host's turn actually produces is `navigate` (jump to the booking
 * request, the listing, the payout screen), `toast` (a broadcast sent, a
 * listing's availability changed), and occasionally `confirm` (host tools
 * that write are still gated the same as a renter's money tools). The
 * backend already refuses a renter-only tool for this caller — see
 * ai-agent's scope enforcement — so nothing client-side needs to hide any
 * capability from the model; this component just doesn't offer the ones
 * that don't apply.
 */
export function HostAiField({ className }: { className?: string }) {
  const navigate = useNavigate();
  const stored = useRef(loadConvo()).current;

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(stored.line);
  const [chips, setChips] = useState<AgentChip[]>(stored.chips);
  const [confirm, setConfirm] = useState<ConfirmState | null>(stored.confirm);

  const sessionIdRef = useRef<string | null>(stored.sessionId);
  const lastMessageRef = useRef<string | null>(stored.lastMessage);
  const inputRef = useRef<HTMLInputElement>(null);
  const gotLineRef = useRef(false);

  useEffect(() => {
    const data: StoredConvo = { sessionId: sessionIdRef.current, line, chips, confirm, lastMessage: lastMessageRef.current };
    try {
      sessionStorage.setItem(CONVO_KEY, JSON.stringify(data));
    } catch {
      // Private mode / quota — the field still works this page view.
    }
  }, [line, chips, confirm]);

  function applyAction(action: AgentAction) {
    switch (action.type) {
      case 'navigate':
        navigate(action.to);
        break;
      case 'toast':
        toast.info(action.text);
        break;
      case 'confirm':
        setConfirm({ summary: action.summary, token: action.token });
        break;
      // 'filters'/'highlight' never arrive here — no host tool produces
      // them — but ignoring rather than throwing keeps this resilient if
      // that ever changes server-side before the client catches up.
      default:
        break;
    }
  }

  async function send(rawMessage: string, confirmToken?: string) {
    const message = rawMessage.trim();
    if (!message || busy) return;
    setBusy(true);
    setConfirm(null);
    setChips([]);
    setLine({ text: 'Thinking…', tone: 'status' });
    lastMessageRef.current = message;
    gotLineRef.current = false;

    await streamAgentTurn(
      {
        sessionId: sessionIdRef.current ?? undefined,
        message,
        confirmToken,
        context: {
          route: '/ai',
          filters: {},
          visibleListingIds: [],
          country: '',
          currency: '',
        },
      },
      (evt) => {
        switch (evt.kind) {
          case 'step':
            gotLineRef.current = true;
            setLine({ text: evt.summary, tone: 'status' });
            break;
          case 'say':
            gotLineRef.current = true;
            setLine({ text: evt.text, tone: 'question' });
            break;
          case 'chips':
            setChips(evt.chips);
            break;
          case 'action':
            applyAction(evt.action);
            break;
          case 'done':
            if (evt.sessionId) sessionIdRef.current = evt.sessionId;
            break;
          case 'error':
            gotLineRef.current = true;
            setLine({ text: evt.message, tone: 'error' });
            break;
        }
      },
    );

    setBusy(false);
    if (!gotLineRef.current) setLine(null);
    setValue('');
    inputRef.current?.focus();
  }

  function confirmYes() {
    const token = confirm?.token;
    const msg = lastMessageRef.current ?? '';
    if (token) void send(msg, token);
  }
  function confirmNo() {
    setConfirm(null);
    setLine(null);
    setChips([]);
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(value);
        }}
        className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-4 py-3 shadow-[var(--shadow-float)] focus-within:border-[var(--color-accent-on)]"
      >
        <Sparkles size={18} className="shrink-0 text-[var(--color-accent-on)]" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          placeholder="Ask about your fleet, a booking, or earnings…"
          className="flex-1 truncate bg-transparent text-body text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)]"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] transition-opacity disabled:opacity-40"
        >
          {busy ? <Spinner size={16} /> : <ArrowRight size={16} />}
        </button>
      </form>

      {line && (
        <p
          className={cn(
            'px-4 text-body-sm',
            line.tone === 'error' ? 'text-[var(--color-danger-500)]' : 'text-[var(--color-content-muted)]',
          )}
        >
          {line.text}
        </p>
      )}

      {confirm && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-4 py-3">
          <p className="text-body-sm text-[var(--color-content)]">{confirm.summary}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={confirmNo}
              className="rounded-[var(--radius-control)] px-3 py-1.5 text-body-sm font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]"
            >
              No
            </button>
            <button
              type="button"
              onClick={confirmYes}
              className="rounded-[var(--radius-control)] bg-[var(--color-accent-on)] px-3 py-1.5 text-body-sm font-semibold text-[var(--color-accent-contrast)]"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <ChipRow>
          {chips.map((c) => (
            <Chip key={c.label} onClick={() => void send(c.send)}>
              {c.label}
            </Chip>
          ))}
        </ChipRow>
      )}
    </div>
  );
}
