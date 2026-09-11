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
import { loadHomeLocation, saveHomeLocation } from '@/lib/homeLocation';

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
 * model.
 *
 * Not because the agent couldn't do it — it can now: `context.location`
 * carries the renter's coordinate and its filter tool takes a `nearMe` flag
 * that turns into the same `nearLat`/`nearLng` this function sets. But that
 * is a streamed round trip, and a model deciding whether to set a flag, to
 * answer a tap on a button that says exactly one thing. The coordinate is
 * already in this component; applying it here is instant and cannot be
 * declined. Same principle as city-match and date-range filtering, which
 * also skip the model when the answer is already known (see SearchBar's
 * onCityMatch/onDateRangeChange). Nothing here is hidden from the agent —
 * the resulting filters go back to it as `context.filters` next turn. */
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
  onFilters: (filters: ListingFilters, clear?: (keyof ListingFilters)[], replace?: boolean) => void;
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
  /**
   * The conversation, for a caller that wants to keep one — what the renter
   * asked and what the agent said back, in order.
   *
   * Only those two. The `step` summaries ("Searching…") and the `Thinking…`
   * placeholder stay on this component's own single line, because they are
   * status rather than conversation: appending them would turn a transcript
   * into a log, and the renter would have to read past the machinery to find
   * the answer. Sentinel chips never arrive here either — `__clear_filters__`
   * and "Closest to me" are intercepted before `send`, so nothing internal
   * leaks into a history the renter is reading.
   *
   * Optional, and the field is unchanged without it: `HostAiPage` renders
   * this same component with no transcript at all.
   */
  onMessage?: (message: { role: 'user' | 'ai'; text: string; tone?: 'error' }) => void;
  /** Whether a turn is in flight, so a caller rendering the transcript can
   * show its own waiting state. Reported rather than inferred from the
   * messages: a turn that only sets filters and offers chips says nothing at
   * all, and a caller guessing "still busy until an answer arrives" would
   * wait on one that is never coming. */
  onBusyChange?: (busy: boolean) => void;
  /** "Start over" was pressed — the session is gone, so a caller holding a
   * transcript should drop it too. */
  onReset?: () => void;
  className?: string;
}

/**
 * The whole AI surface: one text field, one status/question line, and two
 * rows of chips — the agent's own quick replies, and the renter's
 * accumulated understanding (derived straight from `filters`, so removing a
 * chip here is exactly the same action as unclicking a filter on /search).
 * Never renders a turn history itself — only the current line is ever shown,
 * and it is replaced, not appended to, on every turn.
 *
 * A caller that wants the history keeps it: `onMessage` reports the renter's
 * question and the agent's answer as they happen, and `AiPage` renders them
 * over the map. That split is deliberate — the line is status and belongs to
 * the field, the conversation is content and belongs to the page.
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
  onMessage,
  onBusyChange,
  onReset,
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

  useEffect(() => {
    onBusyChange?.(busy);
    // `onBusyChange` is intentionally not a dependency — a caller passing an
    // inline arrow would otherwise re-fire this on every one of its renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

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
        // Offered only while the results are NOT already ranked by distance.
        // A coordinate now arrives on its own — the moment the bar resolves
        // one, and on mount from the renter's saved location (see AiPage's
        // `nearMe`) — so this chip stopped being the only route to proximity
        // and became, in those cases, a button that re-applies the exact
        // coordinate already in effect and visibly does nothing. It is still
        // the only route for a renter who has saved no location and hasn't
        // touched the "Where" box, which is why it stays rather than going.
        // `== null`, not falsy: latitude 0 is the equator, which crosses
        // real markets here.
        ...(filters.nearLat == null || filters.nearLng == null
          ? [{ label: 'Closest to me', send: CLOSEST_TO_ME_SEND }]
          : []),
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
        onFilters(action.filters, action.clear, action.replace);
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
    // Into the transcript before the request goes out, so the renter's own
    // words are on screen while the turn is still running rather than
    // appearing retroactively once it answers.
    onMessage?.({ role: 'user', text: message });
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
            onMessage?.({ role: 'ai', text: evt.text });
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
            onMessage?.({ role: 'ai', text: evt.message, tone: 'error' });
            break;
        }
      },
    );

    setBusy(false);
    if (!gotLineRef.current) setLine(null);
    searchBarRef.current?.focus();
  }

  /**
   * Deterministic, zero-agent-round-trip "Closest to me" — see
   * `CLOSEST_TO_ME_SEND` for why a tap on this doesn't go to the model even
   * though the model could now serve it. Applies `nearLat`/`nearLng`
   * directly through the same `onFilters` callback city/dates already use.
   * Reuses a coordinate this session already resolved, then the renter's
   * saved location, and only asks the browser for a fresh fix when neither
   * exists — the same precedence the agent's own `context.location` uses
   * above, and one fewer permission prompt for a coordinate we already have.
   * A fresh request goes through `useMyLocation()`, the same hook and
   * denial/failure behaviour SearchBar's "use my location" button uses.
   *
   * A city already applied is not cleared here. It used to need to be, and
   * this function was the one path that forgot; the rule now lives in the
   * `onFilters` reducer itself (see AiPage), where a coordinate arriving
   * without a city of its own displaces a stale one no matter which of these
   * paths sent it. Restating it at the call site would put the invariant
   * back in two places, which is how it came to be missing from one.
   */
  function closestToMe() {
    setChips([]);
    const known = lastLocationRef.current ?? savedHomeLocation();
    if (known) {
      lastLocationRef.current = { lat: known.lat, lng: known.lng };
      onFilters({ nearLat: known.lat, nearLng: known.lng });
      setLine(null);
      return;
    }
    setLine({ text: 'Finding your location…', tone: 'status' });
    locate(
      (p) => {
        lastLocationRef.current = p;
        onFilters({ nearLat: p.lat, nearLng: p.lng });
        // Kept, so the next visit ranks by distance without prompting again
        // — the same store and the same raw first label SearchBar writes on
        // its own GPS fix. Without this, the one path that actually costs
        // the renter a permission dialog was also the one that threw the
        // answer away the moment they navigated.
        saveHomeLocation({ lat: p.lat, lng: p.lng, label: 'Current location' });
        setLine(null);
      },
      (reason) => {
        setLine({
          text:
            reason === 'denied'
              ? "Location is blocked for this site — allow it from your browser's address bar."
              : "Couldn't find your location — type a city or airport instead.",
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
    // A caller keeping the transcript clears it here and nowhere else. "Start
    // over" is the only control in this UI that means *forget the
    // conversation*, so it is the only thing that should empty it — leaving a
    // history on screen after the session behind it was thrown away would
    // show the renter turns the agent can no longer remember.
    onReset?.();
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
        // The exact coordinate, applied the moment the bar resolves one —
        // "Closest to me" below is then just the button for asking again
        // later, not the only way to ever get a distance-ranked result.
        onPointMatch={(point) => {
          lastLocationRef.current = point;
          if (point) onFilters({ nearLat: point.lat, nearLng: point.lng });
          else onFilters({}, ['nearLat', 'nearLng']);
        }}
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
