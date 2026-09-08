import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, X } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/currency';
import { CAR_CATEGORIES } from '@/lib/categories';
import { streamAgentTurn, type AgentAction, type AgentChip } from '@/lib/aiAgent';
import { Chip, ChipRow, Spinner, toast } from '@/components/ui';

const CONVO_KEY = 'autohire-ai-convo';

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

/** Per-tab only (sessionStorage, not localStorage) — deliberately: this is
 * meant to survive a navigate to /cars/:id and back, not to greet the renter
 * with an old conversation days later, which reads as the assistant not
 * having forgotten anything (it has no memory UI to show that it did). */
function loadConvo(): StoredConvo {
  try {
    const raw = sessionStorage.getItem(CONVO_KEY);
    if (!raw) return EMPTY_CONVO;
    return { ...EMPTY_CONVO, ...(JSON.parse(raw) as Partial<StoredConvo>) };
  } catch {
    return EMPTY_CONVO;
  }
}

const FILTER_ORDER: (keyof ListingFilters)[] = [
  'query',
  'city',
  'category',
  'transmission',
  'fuel',
  'minSeats',
  'maxPriceRwf',
];

function filterChipLabel(key: keyof ListingFilters, value: unknown): string {
  switch (key) {
    case 'query':
      return `“${value}”`;
    case 'category':
      return CAR_CATEGORIES.find((c) => c.value === value)?.label ?? String(value);
    case 'transmission':
      return value === 'automatic' ? 'Automatic' : 'Manual';
    case 'fuel': {
      const s = String(value);
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case 'minSeats':
      return `${value}+ seats`;
    case 'maxPriceRwf':
      return `≤ ${formatMoney(Number(value), 'RWF')}`;
    default:
      return String(value);
  }
}

export interface ResearchFieldProps {
  /** The accumulated understanding — same ListingFilters shape the manual
   * /search chips use, so an agent-set filter and a hand-clicked one are one
   * system, never two competing states. */
  filters: ListingFilters;
  onFilters: (filters: ListingFilters, clear?: (keyof ListingFilters)[]) => void;
  onHighlight: (ids: string[]) => void;
  onRemoveFilter: (key: keyof ListingFilters) => void;
  onClearFilters: () => void;
  /** The cars currently matching `filters` — what "visibleListingIds" means
   * to the agent, and what a deterministic next-step nudge (below) sorts or
   * offers to book when the model's own turn didn't propose one itself. */
  results: Listing[];
  country: string;
  currency: string;
  /** Where the renter arrived from, e.g. a specific car's page — lets "book
   * this one" resolve immediately instead of asking which car. Neither is
   * wired up by any current entry point; AiPage just forwards whatever
   * location.state/query happens to carry. */
  fromRoute?: string;
  fromListingId?: string;
  /** The `?ask=` on first load — sent once, then the caller is expected to
   * strip it from the URL so a refresh doesn't repeat it. */
  initialAsk?: string | null;
  onConsumedInitialAsk?: () => void;
  className?: string;
}

/**
 * The whole AI surface: one text field, one status/question line, and two
 * rows of chips — the agent's own quick replies, and the renter's
 * accumulated understanding (derived straight from `filters`, so removing a
 * chip here is exactly the same action as unclicking a filter on /search).
 * Never renders a turn history — only the current line is ever shown, and it
 * is replaced, not appended to, on every turn.
 */
export function ResearchField({
  filters,
  onFilters,
  onHighlight,
  onRemoveFilter,
  onClearFilters,
  results,
  country,
  currency,
  fromRoute,
  fromListingId,
  initialAsk,
  onConsumedInitialAsk,
  className,
}: ResearchFieldProps) {
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
  const autoAskedRef = useRef(false);

  // Per-turn bookkeeping — not state, since nothing renders off these
  // directly. `gotLine` decides whether the "Thinking…" placeholder clears
  // to nothing or stays as whatever the turn actually said. `gotChips` and
  // `gotFiltersAction` feed the deterministic next-step nudge below: it only
  // fires when the turn changed the result set and *didn't* already offer
  // its own next step.
  const gotLineRef = useRef(false);
  const gotChipsRef = useRef(false);
  const hadErrorRef = useRef(false);
  const awaitingNudgeRef = useRef(false);

  // Persist the conversation (not the filters — AiPage owns those) so a
  // navigate to /cars/:id and back finds the same line/chips/session rather
  // than a blank field.
  useEffect(() => {
    const data: StoredConvo = {
      sessionId: sessionIdRef.current,
      line,
      chips,
      confirm,
      lastMessage: lastMessageRef.current,
    };
    try {
      sessionStorage.setItem(CONVO_KEY, JSON.stringify(data));
    } catch {
      // Private mode / quota — the field still works this page view.
    }
  }, [line, chips, confirm]);

  useEffect(() => {
    if (autoAskedRef.current || !initialAsk) return;
    autoAskedRef.current = true;
    void send(initialAsk);
    onConsumedInitialAsk?.();
    // Deliberately once — see autoAskedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAsk]);

  // A turn that changed the results but offered no chips of its own gets a
  // client-side nudge once the new count is actually known (the query behind
  // `results` refetches asynchronously, so this can't happen synchronously
  // inside send()). Never overrides the model's own chips — only fills the
  // gap when it left none.
  useEffect(() => {
    if (busy || !awaitingNudgeRef.current || gotChipsRef.current) return;
    awaitingNudgeRef.current = false;
    const count = results.length;
    if (count === 0) {
      setChips([{ label: 'Clear filters', send: '__clear_filters__' }]);
    } else if (count > 8) {
      setChips([
        { label: 'Cheapest first', send: 'Sort these results by price, cheapest first.' },
        { label: 'Closest to me', send: 'Sort these results by distance, closest first.' },
        { label: 'Highest rated', send: 'Sort these results by rating, highest first.' },
      ]);
    } else if (count >= 1 && count <= 3) {
      setChips(results.slice(0, 3).map((l) => ({ label: `Book ${l.title}?`, send: `Book the ${l.title}.` })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, busy]);

  function applyAction(action: AgentAction) {
    switch (action.type) {
      case 'navigate':
        navigate(action.to);
        break;
      case 'filters':
        awaitingNudgeRef.current = true;
        onFilters(action.filters, action.clear);
        break;
      case 'highlight':
        onHighlight(action.ids);
        break;
      case 'toast':
        toast.info(action.text);
        break;
      case 'confirm':
        setConfirm({ summary: action.summary, token: action.token });
        break;
    }
  }

  async function send(rawMessage: string, confirmToken?: string) {
    const message = rawMessage.trim();
    if (!message || busy) return;
    setBusy(true);
    // Deliberately not cleared here — an error leaves the field exactly as
    // typed, so the renter can fix and resend without retyping. It clears at
    // the end, only on a non-error outcome (see the `finally`-equivalent
    // below).
    setConfirm(null);
    setChips([]);
    setLine({ text: 'Thinking…', tone: 'status' });
    lastMessageRef.current = message;
    gotLineRef.current = false;
    gotChipsRef.current = false;
    hadErrorRef.current = false;

    await streamAgentTurn(
      {
        sessionId: sessionIdRef.current ?? undefined,
        message,
        confirmToken,
        context: {
          route: '/ai',
          from: fromRoute,
          listingId: fromListingId,
          filters,
          visibleListingIds: results.map((l) => l.id),
          country,
          currency,
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
            gotChipsRef.current = true;
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
            hadErrorRef.current = true;
            setLine({ text: evt.message, tone: 'error' });
            break;
        }
      },
    );

    setBusy(false);
    if (!gotLineRef.current) setLine(null);
    if (!hadErrorRef.current) setValue('');
    inputRef.current?.focus();
  }

  function onChipTap(chip: AgentChip) {
    if (chip.send === '__clear_filters__') {
      onClearFilters();
      setChips([]);
      setLine(null);
      return;
    }
    void send(chip.send);
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

  function startOver() {
    onClearFilters();
    sessionIdRef.current = null;
    lastMessageRef.current = null;
    setChips([]);
    setConfirm(null);
    setLine(null);
    try {
      sessionStorage.removeItem(CONVO_KEY);
    } catch {
      // ignore
    }
  }

  const understandingChips = FILTER_ORDER.filter((k) => {
    const v = filters[k];
    return v !== undefined && v !== null && v !== '';
  }).map((k) => ({ key: k, label: filterChipLabel(k, filters[k]) }));

  return (
    // `flex-col-reverse` on mobile puts the line/chips visually above the
    // field (closer to the results sheet) and the field last (closest to the
    // tab bar) purely via CSS, from the same DOM order `lg:flex-col` reads
    // top-to-bottom on desktop (field first, then status, then chips) — one
    // instance, no duplicated state between breakpoints.
    <div className={cn('flex flex-col-reverse gap-2 lg:flex-col', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(value);
        }}
        className="flex h-14 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-1 pl-4 pr-1.5 shadow-[var(--shadow-float)]"
      >
        <Sparkles size={17} className="shrink-0 text-[var(--color-accent-on)]" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe the car you need…"
          aria-label="Ask the AI assistant"
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] disabled:opacity-40"
        >
          {busy ? <Spinner size={15} /> : <ArrowRight size={17} />}
        </button>
      </form>

      {/* Reserved-height slot so the field never jumps when a line/chips
          appear or clear — height still varies (chips can wrap to nothing),
          but the minimum keeps idle state from collapsing to zero. */}
      <div className="flex min-h-11 flex-col justify-end gap-1.5">
        {line && (
          <p
            className={cn(
              'animate-popover-in max-w-full truncate rounded-[var(--radius-pill)] border px-3 py-1.5 text-body-sm shadow-[var(--shadow-float)]',
              line.tone === 'error'
                ? 'border-transparent bg-[var(--color-danger-tint)] text-[var(--color-danger-500)]'
                : 'border-[var(--color-line)] bg-[var(--color-surface-raised)] text-[var(--color-content)]',
            )}
          >
            {confirm ? confirm.summary : line.text}
          </p>
        )}
        {confirm ? (
          <ChipRow className="animate-popover-in">
            <Chip selected onClick={confirmYes}>
              Confirm
            </Chip>
            <Chip onClick={confirmNo}>No</Chip>
          </ChipRow>
        ) : (
          chips.length > 0 && (
            <ChipRow className="animate-popover-in">
              {chips.map((c) => (
                <Chip key={c.label} onClick={() => onChipTap(c)}>
                  {c.label}
                </Chip>
              ))}
            </ChipRow>
          )
        )}
      </div>

      {understandingChips.length > 0 && (
        <ChipRow>
          {understandingChips.map(({ key, label }) => (
            <Chip key={key} onClick={() => onRemoveFilter(key)}>
              {label}
              <X size={12} />
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => navigate('/search', { state: { filters } })}
            className="shrink-0 whitespace-nowrap text-body-sm font-semibold text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:underline"
          >
            Show in browse
          </button>
          <button
            type="button"
            onClick={startOver}
            className="shrink-0 whitespace-nowrap text-body-sm text-[var(--color-content-subtle)] hover:text-[var(--color-content-muted)] hover:underline"
          >
            ✕ Start over
          </button>
        </ChipRow>
      )}
    </div>
  );
}
