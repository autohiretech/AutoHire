import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  History,
  PanelLeft,
  Paperclip,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Star,
  X,
} from 'lucide-react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatRwf } from '@/lib/format';
import { CAR_CATEGORIES } from '@/lib/categories';
import { buildSummary, describeThought, interpretQuery } from '@/lib/demoAi';

/** Quick-start prompts, shown under the hero box (AutoHire-flavoured). */
const SUGGESTIONS = [
  { emoji: '🔥', text: 'Automatic SUV for 5 people' },
  { emoji: '✨', text: 'Cheapest cars in Kigali' },
  { emoji: '🛬', text: 'Car for airport pickup' },
  { emoji: '🏢', text: 'Verified business hosts' },
  { emoji: '👨‍👩‍👧', text: '7-seater for a family trip' },
];

type Turn = {
  id: number;
  query: string;
  status: 'thinking' | 'done';
  thought: string;
  summary: string;
  filters: ListingFilters;
  listings: Listing[];
};

/**
 * AI Mode — a conversational sourcing experience (Accio-style). The "AI" is a
 * local demo ([demoAi]) so it runs without API credits: it interprets the
 * request into filters, pulls real listings, and writes a summary. Before the
 * first ask it shows a hero prompt; after, a chat transcript + follow-up box.
 */
export function AiMode() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const started = turns.length > 0;

  function newChat() {
    setTurns([]);
    setInput('');
    setHistoryOpen(false);
  }

  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, started]);

  async function ask(raw: string) {
    const query = raw.trim();
    if (!query || busy) return;
    setInput('');
    setBusy(true);
    const id = nextId.current++;
    const filters = interpretQuery(query);
    // Show the user's turn + a "thinking" placeholder immediately.
    setTurns((t) => [
      ...t,
      { id, query, status: 'thinking', thought: describeThought(query, filters), summary: '', filters, listings: [] },
    ]);
    try {
      // Simulate the model deliberating, then use the real listings data.
      await new Promise((r) => setTimeout(r, 900));
      const listings = await client.listListings(filters);
      const summary = buildSummary(query, listings);
      setTurns((t) =>
        t.map((turn) => (turn.id === id ? { ...turn, status: 'done', summary, listings } : turn)),
      );
    } catch {
      setTurns((t) =>
        t.map((turn) =>
          turn.id === id
            ? { ...turn, status: 'done', summary: 'Something went wrong fetching cars. Please try again.', listings: [] }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Hero (pre-conversation) ──────────────────────────────────────────────
  const content = !started ? (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <h1 className="text-center text-2xl font-bold text-ink-900 sm:text-3xl">
          All cars in one ask, smart renting with AI
        </h1>
        <div className="mt-6">
          <PromptBox
            value={input}
            onChange={setInput}
            onSubmit={() => ask(input)}
            busy={busy}
            placeholder="Describe the car you need…"
            large
          />
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              type="button"
              onClick={() => ask(s.text)}
              className="rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <span className="mr-1">{s.emoji}</span>
              {s.text}
            </button>
          ))}
        </div>
      </div>
  ) : (
    // ── Conversation ───────────────────────────────────────────────────────
    <div className="mx-auto max-w-4xl px-4 pb-40 pt-4">
      <div className="space-y-10">
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Sticky follow-up box */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white to-transparent pb-5 pt-8">
        <div className="mx-auto max-w-4xl px-4">
          <PromptBox
            value={input}
            onChange={setInput}
            onSubmit={() => ask(input)}
            busy={busy}
            placeholder="Ask a follow-up…"
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <AiSideRail
        historyOpen={historyOpen}
        hasTurns={started}
        onNewChat={newChat}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
      />
      {historyOpen && (
        <AiHistoryDrawer
          turns={turns}
          onNewChat={newChat}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {content}
    </>
  );
}

/**
 * Left tool rail for AI Mode (echoes Accio's left icons): collapse/expand the
 * history panel, start a new chat, and open recent prompts. Shown from lg up,
 * where the centred conversation leaves room in the left margin.
 */
function AiSideRail({
  historyOpen,
  hasTurns,
  onNewChat,
  onToggleHistory,
}: {
  historyOpen: boolean;
  hasTurns: boolean;
  onNewChat: () => void;
  onToggleHistory: () => void;
}) {
  return (
    <div className="fixed left-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1 rounded-2xl border border-ink-100 bg-white/95 p-1.5 shadow-lg backdrop-blur lg:flex">
      <RailButton
        label="Panel"
        icon={PanelLeft}
        active={historyOpen}
        onClick={onToggleHistory}
      />
      <RailButton label="New chat" icon={SquarePen} onClick={onNewChat} />
      <RailButton
        label="History"
        icon={History}
        active={historyOpen}
        onClick={onToggleHistory}
        disabled={!hasTurns}
      />
    </div>
  );
}

function RailButton({
  label,
  icon: Icon,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  icon: typeof PanelLeft;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex w-14 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-accent-50 text-accent-700' : 'text-ink-600 hover:bg-accent-50 hover:text-accent-700',
      )}
    >
      <Icon size={20} />
      {label}
    </button>
  );
}

/** Slide-in panel listing this session's prompts (Accio-style history). */
function AiHistoryDrawer({
  turns,
  onNewChat,
  onClose,
}: {
  turns: Turn[];
  onNewChat: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed left-20 top-24 z-30 hidden w-60 flex-col rounded-2xl border border-ink-100 bg-white p-3 shadow-xl lg:flex">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink-900">Recent</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
        >
          <X size={15} />
        </button>
      </div>
      <button
        type="button"
        onClick={onNewChat}
        className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-ink-200 px-3 py-2 text-sm font-medium text-ink-600 hover:border-accent-300 hover:text-accent-700"
      >
        <SquarePen size={15} /> New chat
      </button>
      {turns.length === 0 ? (
        <p className="px-1 py-2 text-xs text-ink-400">No prompts yet.</p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {[...turns].reverse().map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={onClose}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
              >
                <History size={14} className="mt-0.5 shrink-0 text-ink-400" />
                <span className="line-clamp-2">{t.query}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A single question → answer exchange. */
function TurnView({ turn }: { turn: Turn }) {
  const [showThought, setShowThought] = useState(false);
  return (
    <div>
      {/* User query, right-aligned chip */}
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-tr-sm bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
          {turn.query}
        </div>
      </div>

      {/* Thought process */}
      <button
        type="button"
        onClick={() => setShowThought((v) => !v)}
        className="mt-5 flex items-center gap-1.5 text-sm font-medium text-accent-600"
      >
        <Sparkles size={15} />
        {turn.status === 'thinking' ? 'Thinking…' : 'Show thought process'}
        {turn.status === 'done' && (
          <ChevronDown size={15} className={cn('transition-transform', showThought && 'rotate-180')} />
        )}
      </button>
      {(showThought || turn.status === 'thinking') && (
        <p className="mt-2 border-l-2 border-accent-200 pl-3 text-sm text-ink-500">{turn.thought}</p>
      )}

      {/* Assistant answer */}
      {turn.status === 'thinking' ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-400">
          <span className="h-2 w-2 animate-bounce rounded-full bg-ink-300 [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-ink-300 [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-ink-300" />
        </div>
      ) : (
        <>
          <p className="mt-4 leading-relaxed text-ink-800">{turn.summary}</p>
          {turn.listings.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-3 text-lg font-semibold text-ink-900">
                {CAR_CATEGORIES.find((c) => c.value === turn.filters.category)?.label ?? 'Matching cars'}
              </h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {turn.listings.slice(0, 8).map((l) => (
                  <AiCarCard key={l.id} listing={l} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Result card echoing Alibaba's AI cards: match badge, price, host line. */
function AiCarCard({ listing }: { listing: Listing }) {
  return (
    <Link
      to={`/cars/${listing.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="h-32 overflow-hidden bg-ink-50">
        <img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col p-3">
        <span className="mb-1.5 w-fit rounded bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-700">
          Matches your request
        </span>
        <h4 className="line-clamp-2 text-sm font-medium text-ink-900">{listing.title}</h4>
        <p className="mt-1 text-sm font-semibold text-ink-900">
          {formatRwf(listing.pricePerDayRwf)}
          <span className="font-normal text-ink-400"> /day</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-500">{listing.location}</p>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
          <span className="flex items-center gap-0.5">
            <Star size={12} className="fill-accent-400 text-accent-400" /> {listing.ratingAvg.toFixed(1)}
          </span>
          <span className="flex items-center gap-0.5 capitalize">
            <ShieldCheck size={12} className="text-brand-500" />
            {listing.ownerType === 'business' ? 'Agency' : 'Individual'}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** The rounded prompt box with attach + send, used for the hero and follow-up. */
function PromptBox({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder,
  large = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  large?: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="rounded-2xl border border-accent-300 bg-white p-3 shadow-[0_4px_24px_rgba(245,158,11,0.12)] focus-within:border-accent-400"
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={large ? 2 : 1}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full resize-none px-2 pt-1 text-base text-ink-900 outline-none placeholder:text-ink-400"
      />
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Attach"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
        >
          <Paperclip size={18} />
        </button>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-accent-500 to-accent-600 text-white transition-opacity hover:brightness-95 disabled:opacity-40"
        >
          {busy ? <Sparkles size={16} className="animate-pulse" /> : <ArrowRight size={18} />}
        </button>
      </div>
    </form>
  );
}
