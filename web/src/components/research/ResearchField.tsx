import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import type { ListingFilters } from '@/lib/types';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/format';
import { CAR_CATEGORIES } from '@/lib/categories';
import { streamAgentTurn, type AgentAction, type AgentChip } from '@/lib/aiAgent';
import { useMyLocation, type Coordinates } from '@/lib/useMyLocation';
import { Chip, ChipRow, toast } from '@/components/ui';
import { SearchBar, type SearchBarHandle } from '@/components/research/SearchBar';
import { loadHomeLocation } from '@/lib/homeLocation';

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

/** Sentinel `AgentChip.send` value, same trick as `__clear_filters__` below:
 * a chip label the nudge effect offers, but tapping it never reaches the
 * model — "closest first" needs the renter's own coordinate, which the
 * agent has no way to know (no lat/lng anywhere in its tool schema or
 * request context, by design), so this has to be resolved and applied
 * entirely on the client, the same principle already applied to city-match
 * and date-range filtering (see SearchBar's onCityMatch/onDateRangeChange). */
const CLOSEST_TO_ME_SEND = '__closest_to_me__';

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
  /** "Use my location" reverse-geocoded into a different market than the one
   * selected — same as typing a city that belongs to another market already
   * retargets `/search`. Optional: a caller with no market switch to offer
   * can leave it out. */
  onCountryMatch?: (country: string) => void;
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
/** The renter's saved Account location as an agent-context coordinate, or
 * null when they never set one. */
function savedHomeLocation(): { lat: number; lng: number; label: string } | null {
  const home = loadHomeLocation();
  return home ? { lat: home.lat, lng: home.lng, label: home.label } : null;
}

export function ResearchField({
  filters,
  onFilters,
  onHighlight,
  onRemoveFilter,
  onClearFilters,
  results,
  country,
  currency,
  onCountryMatch,
  fromRoute,
  fromListingId,
  initialAsk,
  onConsumedInitialAsk,
  className,
}: ResearchFieldProps) {
  const navigate = useNavigate();
  const stored = useRef(loadConvo()).current;

  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(stored.line);
  const [chips, setChips] = useState<AgentChip[]>(stored.chips);
  const [confirm, setConfirm] = useState<ConfirmState | null>(stored.confirm);

  const sessionIdRef = useRef<string | null>(stored.sessionId);
  const lastMessageRef = useRef<string | null>(stored.lastMessage);
  const searchBarRef = useRef<SearchBarHandle>(null);
  const autoAskedRef = useRef(false);
  // The last coordinate SearchBar resolved (a picked suggestion or "use my
  // location"), captured off its onSubmit — not persisted across a page
  // load, same lifetime as the rest of this field's per-tab state. "Closest
  // to me" reuses it instead of forcing a fresh GPS prompt when one's
  // already sitting right there.
  const lastLocationRef = useRef<Coordinates | null>(null);
  const { locate } = useMyLocation();

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
        { label: 'Closest to me', send: CLOSEST_TO_ME_SEND },
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
          // Whatever this session has already resolved — a coordinate the
          // renter picked or geolocated in the field — else their saved
          // Account location. Never a fabricated default: when neither
          // exists this stays undefined and the agent is told it doesn't
          // know where they are.
          location: lastLocationRef.current ?? savedHomeLocation() ?? undefined,
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
    searchBarRef.current?.focus();
  }

  /**
   * Deterministic, zero-agent-round-trip "Closest to me" — the model has no
   * lat/lng anywhere in its tool schema or request context (by design, see
   * `CLOSEST_TO_ME_SEND`'s comment), so this applies `nearLat`/`nearLng`
   * directly through the same `onFilters` callback city/dates already use.
   * Reuses a coordinate SearchBar already resolved if there is one; otherwise
   * triggers a fresh `useMyLocation()` request, the same hook and behavior
   * SearchBar's own "use my location" button already uses for denial/failure.
   */
  function closestToMe() {
    setChips([]);
    if (lastLocationRef.current) {
      const { lat, lng } = lastLocationRef.current;
      onFilters({ nearLat: lat, nearLng: lng });
      setLine(null);
      return;
    }
    setLine({ text: 'Finding your location…', tone: 'status' });
    locate(
      (p) => {
        lastLocationRef.current = p;
        onFilters({ nearLat: p.lat, nearLng: p.lng });
        setLine(null);
      },
      () => {
        setLine({
          text: "Couldn't get your location — check your browser's location permission.",
          tone: 'error',
        });
      },
    );
  }

  function onChipTap(chip: AgentChip) {
    if (chip.send === '__clear_filters__') {
      onClearFilters();
      setChips([]);
      setLine(null);
      return;
    }
    if (chip.send === CLOSEST_TO_ME_SEND) {
      closestToMe();
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

  // Dates are one chip, not two — `startDate`/`endDate` are both-or-neither
  // on `ListingFilters`, so a per-key chip (raw ISO text, and removable one
  // side at a time) would both read wrong and leave the filter in a state
  // nothing else here produces. `FILTER_ORDER` deliberately excludes them.
  const dateChip =
    filters.startDate && filters.endDate
      ? { key: 'dates' as const, label: `${formatDate(filters.startDate)} – ${formatDate(filters.endDate)}` }
      : null;
  const understandingChips = [
    ...(dateChip ? [dateChip] : []),
    ...FILTER_ORDER.filter((k) => {
      const v = filters[k];
      return v !== undefined && v !== null && v !== '';
    }).map((k) => ({ key: k, label: filterChipLabel(k, filters[k]) })),
  ];

  return (
    // `flex-col-reverse` on mobile puts the line/chips visually above the
    // field (closer to the results sheet) and the field last (closest to the
    // tab bar) purely via CSS, from the same DOM order `lg:flex-col` reads
    // top-to-bottom on desktop (field first, then status, then chips) — one
    // instance, no duplicated state between breakpoints.
    <div className={cn('flex flex-col-reverse gap-2 lg:flex-col', className)}>
      <SearchBar
        ref={searchBarRef}
        onSubmit={(input) => {
          // Captured for "Closest to me" below — a resolved place/GPS point
          // from this same field, not a fresh network round trip through the
          // agent. Doesn't change what's sent to the model at all.
          if (input.location) lastLocationRef.current = { lat: input.location.lat, lng: input.location.lng };
          void send(input.message);
        }}
        onCityMatch={(city) => (city ? onFilters({ city }) : onRemoveFilter('city'))}
        onCountryMatch={onCountryMatch}
        onDateRangeChange={(r) =>
          r.start && r.end
            ? onFilters({ startDate: r.start, endDate: r.end })
            : onFilters({}, ['startDate', 'endDate'])
        }
        placeholder="Describe the car you need…"
        disabled={busy}
        aiOnly
      />

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
            <Chip
              key={key}
              onClick={() =>
                key === 'dates' ? onFilters({}, ['startDate', 'endDate']) : onRemoveFilter(key)
              }
            >
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
