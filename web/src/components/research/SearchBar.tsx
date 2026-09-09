import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import {
  BedDouble,
  Building2,
  ChevronDown,
  Clock,
  Globe,
  MapPin,
  Navigation,
  Plane,
  Search,
  Sparkles,
  TrainFront,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Spinner } from '@/components/ui';
import {
  useAddressSuggestions,
  reverseGeocode,
  type AddressSuggestion,
  type PlaceKind,
} from '@/lib/geocoding';
import { useMyLocation } from '@/lib/useMyLocation';
import { useCountry } from '@/lib/country';
import { matchKnownCity } from '@/lib/cities';
import { useT } from '@/lib/i18n';
import { DateRangeCalendar, type DateRange } from '@/components/marketplace/DateRangeCalendar';

export interface SearchBarLocation {
  lat: number;
  lng: number;
  label: string;
}

export interface SearchBarSubmitInput {
  /** Composed prose for the agent — the "Where"/dates/times context (when
   * present) prefixed onto whatever the renter typed in the free-text row.
   * Always non-empty if anything at all was entered. */
  message: string;
  location?: SearchBarLocation;
  dateRange?: { start: string | null; end: string | null };
}

export interface SearchBarHandle {
  focus: () => void;
}

export interface SearchBarProps {
  onSubmit: (input: SearchBarSubmitInput) => void;
  /** Fires the instant a typed/picked "Where" resolves to one of the app's
   * known cities (or stops matching one) — the one field here that can do
   * real, immediate `ListingFilters.city` filtering with no agent round
   * trip. `undefined` means "no match" / "cleared", not "leave as-is". */
  onCityMatch?: (city: string | undefined) => void;
  /** Fires on every From/Until change, immediately — same "no submit
   * needed" treatment as `onCityMatch`, now that `ListingFilters.startDate`/
   * `endDate` are a real, availability-aware filter
   * (`search_available_listings`, migration 074) rather than prose the
   * agent has to interpret. `{ start: null, end: null }` means cleared. */
  onDateRangeChange?: (range: { start: string | null; end: string | null }) => void;
  /** Fires when "use my location" reverse-geocodes into a different market
   * than the one currently selected — e.g. the renter is physically in
   * Kigali but the header is still set to a market from a past visit.
   * Optional: a caller with no market to switch (there's only ever the one
   * header) can simply not pass it. */
  onCountryMatch?: (country: string) => void;
  initialValue?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Drop the Search/Ask AI toggle and stay in AI mode. For `/ai`, which is
   * the agent's own room — landing there on the structured Where/From/Until
   * bar, with "Ask AI" as something you still have to opt into, contradicts
   * the whole point of having navigated to the AI page. Home's hero keeps
   * the toggle: there, Search is the default and AI is the opt-in. */
  aiOnly?: boolean;
  className?: string;
}

const EMPTY_RANGE: DateRange = { start: null, end: null };
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const RECENTS_KEY = 'autohire-searchbar-recents';
interface RecentSearch {
  label: string;
  dateLabel?: string;
}
function loadRecents(): RecentSearch[] {
  try {
    const raw = sessionStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
  } catch {
    return [];
  }
}
function saveRecent(entry: RecentSearch) {
  try {
    const list = loadRecents().filter((r) => r.label !== entry.label);
    list.unshift(entry);
    sessionStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    // Private mode / quota — recents just don't persist this session.
  }
}

function parseIsoLocal(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatSingleDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = parseIsoLocal(iso);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}
function formatDateRange(r: DateRange): string | null {
  if (!r.start) return null;
  if (!r.end || r.end === r.start) return formatSingleDate(r.start);
  const s = parseIsoLocal(r.start);
  const e = parseIsoLocal(r.end);
  return s.getMonth() === e.getMonth()
    ? `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} – ${e.getDate()}`
    : `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} – ${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
}
function formatTimeLabel(hhmm: string): string {
  const [hStr, m] = hhmm.split(':');
  const h24 = Number(hStr);
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${period}`;
}
/** 48 half-hour slots, "9:00 AM" style — the app has no existing time-picker
 * to reuse, and a plain native `<input type="time">` renders a different
 * widget per browser/OS; a `<select>` of fixed increments looks the same
 * everywhere and matches how a rental pickup/return time is actually chosen
 * (nobody needs the minute). */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return { value: `${String(h24).padStart(2, '0')}:${m}`, label: formatTimeLabel(`${h24}:${m}`) };
});

/** Short, human label for the free-text prefix — "Kigali" out of a full
 * Nominatim address, or "your location" for a raw geolocated coordinate
 * (there is no reverse-geocoded place name for that case in this app). */
function shortLocationLabel(label: string): string {
  return label.startsWith('Current location') ? 'your location' : label.split(',')[0].trim();
}

const KIND_ICONS: Record<PlaceKind, typeof MapPin> = {
  airport: Plane,
  hotel: BedDouble,
  transit: TrainFront,
  city: Building2,
  place: MapPin,
};

/** "Add dates" is the label this bar wants, but on a phone the From/Until
 * segments are ~70px of text width and it truncates to "Add d…". The caption
 * directly above already says which end of the range this is, so the narrow
 * form drops the verb rather than clipping the noun. Two spans, because CSS
 * can swap visibility per container width and cannot swap text. */
function EmptyDateLabel() {
  const t = useT();
  return (
    <>
      <span className="@md:hidden">{t('search.dates')}</span>
      <span className="hidden @md:inline">{t('search.addDates')}</span>
    </>
  );
}

/**
 * One row of the location picker.
 *
 * The icon sits in a filled circular badge rather than floating naked beside
 * the text: at eight rows the badges form a single scannable column down the
 * left edge, which is what makes a list this long readable at a glance
 * instead of a wall of similar strings. It uses the same `surface-inverse`
 * fill every selected Chip and secondary Button in this app uses, so it
 * costs no new colour.
 *
 * Two lines, not one clamped to two: a Nominatim `display_name` is a full
 * comma-separated address, and clamping it buries the part that identifies
 * the place ("Kigali International Airport") in the middle of the part that
 * merely locates it. Split at the first comma and the name leads.
 */
function PickerRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: typeof MapPin;
  title: ReactNode;
  subtitle?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-[var(--color-content)]">{title}</span>
        {subtitle && (
          <span className="block truncate text-caption text-[var(--color-content-subtle)]">{subtitle}</span>
        )}
      </span>
    </button>
  );
}

/** "Kigali International Airport, KK 147 Street, Kanombe, …" reads as a name
 * plus where it is — so lead with the name and demote the rest. */
function splitAddress(label: string): { name: string; context?: string } {
  const i = label.indexOf(',');
  if (i === -1) return { name: label };
  return { name: label.slice(0, i).trim(), context: label.slice(i + 1).trim() };
}

function TimeSelect({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex shrink-0 items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={placeholder}
        className="w-[92px] appearance-none bg-transparent py-0.5 pr-4 text-body-sm text-[var(--color-content)] outline-none disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {TIME_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-0 text-[var(--color-content-subtle)]" />
    </div>
  );
}

/**
 * The Turo-style compound search bar: Where / From / Until / a round search
 * button, plus a subtler free-text row underneath — one shared component so
 * Home's hero and /ai's field can never drift into two different bars.
 *
 * Two segments do *real* filtering, no agent round trip, the instant they
 * change — same as clicking a `/search` filter chip: "Where", when it
 * matches one of this market's known cities (`onCityMatch`), and From/Until
 * (`onDateRangeChange`), which is real availability filtering as of
 * migration 074 (`search_available_listings` excludes any listing with a
 * conflicting booking). Everything else — an unmatched place, the
 * pickup/return time — has nowhere structured to land, so it's carried as
 * plain prose in `message` for the agent's own `resolve_place` tool (or just
 * its own judgement) to make sense of; a matched city or a set date range is
 * deliberately left OUT of that prose once it's already a live filter, so
 * the agent is never asked to re-derive something already applied. Nothing
 * here claims a capability the app doesn't have: no per-row place categories
 * (Nominatim doesn't return any), no time-of-day filtering (no such field
 * exists — pickup/return time is carried for a future booking prefill, not
 * used to narrow results).
 */
export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar(
  {
    onSubmit,
    onCityMatch,
    onDateRangeChange,
    onCountryMatch,
    initialValue = '',
    placeholder = 'Anything else? SUV, under 150k, automatic…',
    disabled = false,
    aiOnly = false,
    className,
  },
  ref,
) {
  const { country } = useCountry();
  const t = useT();

  // Which face the bar shows — the renter's own choice, not automatic.
  // 'search' is the default because it's what most of every session is:
  // pick a place, pick dates, done, no model call anywhere in the loop.
  // 'ai' is opt-in, for the minority of asks a filter can't express
  // ("something for a wedding, cheap, automatic"). Switching doesn't touch
  // whatever's already applied — a city/date match from 'search' stays live
  // and reaches the agent as `context.filters`, just no longer restated as
  // prose once excluded below, same as before this toggle existed.
  const [mode, setMode] = useState<'search' | 'ai'>(aiOnly ? 'ai' : 'search');
  const [locationText, setLocationText] = useState('');
  const [locationPoint, setLocationPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(EMPTY_RANGE);
  const [datesOpen, setDatesOpen] = useState(false);
  const [pickupTime, setPickupTime] = useState('');
  const [returnTime, setReturnTime] = useState('');
  const [freeText, setFreeText] = useState(initialValue);
  const [recents, setRecents] = useState<RecentSearch[]>(() => loadRecents());

  const { locating, locate } = useMyLocation();
  // Covers the reverse-geocode network call too, which happens after the GPS
  // fix `locating` already tracks — without this the button would flash back
  // to idle between "found your GPS fix" and "found what that place is."
  const [resolvingPlace, setResolvingPlace] = useState(false);
  const busyLocating = locating || resolvingPlace;
  const { suggestions, searching } = useAddressSuggestions(locationText);

  const locationBoxRef = useRef<HTMLDivElement>(null);
  const datesBoxRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const freeTextRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => freeTextRef.current?.focus() }));

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (locationBoxRef.current && !locationBoxRef.current.contains(e.target as Node)) setSuggestOpen(false);
      // Both the trigger segment and the panel count as "inside" — the
      // panel is a sibling of the segment now, not a descendant, so checking
      // only the segment would close the calendar on the first day clicked.
      const inTrigger = datesBoxRef.current?.contains(e.target as Node);
      const inPanel = calendarRef.current?.contains(e.target as Node);
      if (!inTrigger && !inPanel) setDatesOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function onLocationTextChange(value: string) {
    setLocationText(value);
    setLocationPoint(null);
    setSuggestOpen(true);
    onCityMatch?.(matchKnownCity(value, country.code));
  }

  function pickSuggestion(s: AddressSuggestion) {
    setLocationText(s.label);
    setLocationPoint({ lat: s.lat, lng: s.lng });
    setSuggestOpen(false);
    onCityMatch?.(matchKnownCity(s.label, country.code));
  }

  function pickRecent(r: RecentSearch) {
    setLocationText(r.label);
    setLocationPoint(null);
    setSuggestOpen(false);
    onCityMatch?.(matchKnownCity(r.label, country.code));
  }

  function useCurrentLocationClick() {
    locate(async (p) => {
      // Show the raw fix immediately — reverse geocoding is a second network
      // round trip, and the renter shouldn't stare at "Finding you…" for both
      // when the GPS fix alone is already worth showing.
      setLocationText(`Current location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
      setLocationPoint(p);
      setSuggestOpen(false);
      onCityMatch?.(undefined);

      setResolvingPlace(true);
      try {
        const resolved = await reverseGeocode(p.lat, p.lng);
        if (!resolved) return; // network/lookup failure — the raw fix stands.
        setLocationText(resolved.label);
        const matched = matchKnownCity(resolved.place, resolved.countryCode ?? country.code);
        onCityMatch?.(matched);
        if (resolved.countryCode && resolved.countryCode !== country.code) {
          onCountryMatch?.(resolved.countryCode);
        }
      } finally {
        setResolvingPlace(false);
      }
    });
  }

  function pickAnywhere() {
    setLocationText('');
    setLocationPoint(null);
    setSuggestOpen(false);
    onCityMatch?.(undefined);
  }

  function onDatesChange(r: DateRange) {
    setDateRange(r);
    if (r.start && r.end) setDatesOpen(false);
    // Real, immediate filtering (search_available_listings, migration 074) —
    // not something to also hand the agent as prose to re-interpret.
    onDateRangeChange?.(r);
  }

  function clearDates() {
    setDateRange(EMPTY_RANGE);
    onDateRangeChange?.(EMPTY_RANGE);
  }

  /**
   * The agent only gets prose for what it still has to figure out. A
   * matched city and a picked date range are already real, live filters by
   * the time this runs (`onCityMatch`/`onDateRangeChange` fire the instant
   * each changes) — restating them here would have the agent re-deriving a
   * filter that's already applied, which is either redundant or, worse, a
   * second source of truth that can disagree with the first. Pickup/return
   * time has nowhere structured to go yet (no time-of-day filter exists), so
   * it's still carried as prose — an honest gap, not a silently dropped one.
   */
  function composeMessage(): string {
    const bits: string[] = [];
    const loc = locationText.trim();
    const matchedCity = matchKnownCity(loc, country.code);
    if (loc && !matchedCity) {
      bits.push(
        locationPoint
          ? `Near ${shortLocationLabel(loc)} (${locationPoint.lat.toFixed(4)}, ${locationPoint.lng.toFixed(4)})`
          : `Near ${loc}`,
      );
    }
    const timeBits: string[] = [];
    if (pickupTime) timeBits.push(`pickup ${formatTimeLabel(pickupTime)}`);
    if (returnTime) timeBits.push(`return ${formatTimeLabel(returnTime)}`);
    if (timeBits.length) bits.push(timeBits.join(', '));

    const prefix = bits.length ? `${bits.join(', ')}.` : '';
    const free = freeText.trim();
    return prefix && free ? `${prefix} ${free}` : prefix || free;
  }

  function submit() {
    if (mode === 'search') {
      // Nothing here goes to a model, on purpose — that's the whole point of
      // the renter having picked this mode. A matched city and picked dates
      // already applied live (onCityMatch/onDateRangeChange fire the instant
      // each changes); the button's only job left is closing an open picker.
      setDatesOpen(false);
      if (locationText.trim()) {
        const entry: RecentSearch = { label: locationText.trim(), dateLabel: formatDateRange(dateRange) ?? undefined };
        saveRecent(entry);
        setRecents(loadRecents());
      }
      return;
    }
    const message = composeMessage();
    if (!message) return;
    onSubmit({
      message,
      location: locationPoint ? { ...locationPoint, label: locationText.trim() } : undefined,
      dateRange: dateRange.start ? dateRange : undefined,
    });
    setFreeText('');
  }

  // Search mode's button is a "done, close this" confirm, not a submit gated
  // on content — the filtering already happened live. Only AI mode needs
  // something worth sending before it lights up.
  const hasMessage = mode === 'search' || !!composeMessage();
  const fromLabel = formatSingleDate(dateRange.start);
  const untilLabel = formatSingleDate(dateRange.end);
  const showRecents = locationText.trim().length === 0 && recents.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn('@container flex flex-col gap-2', className)}
    >
      {/* The renter's own choice, front and centre — not a corner control
          easy to miss. Search is first and inverts when active, same
          fill-and-weight language every selected Chip in this app uses, so
          "which mode am I in" reads the same way "which filter is on" does
          everywhere else. */}
      <div
        className={cn(
          'flex items-center gap-1 self-start rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)] p-1',
          // On /ai there is nothing to toggle to — see `aiOnly`.
          aiOnly && 'hidden',
        )}
      >
        <button
          type="button"
          onClick={() => setMode('search')}
          aria-pressed={mode === 'search'}
          className={cn(
            'flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-body-sm font-semibold transition-colors',
            mode === 'search'
              ? 'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
              : 'text-[var(--color-content-muted)]',
          )}
        >
          <Search size={13} /> {t('search.modeSearch')}
        </button>
        <button
          type="button"
          onClick={() => setMode('ai')}
          aria-pressed={mode === 'ai'}
          className={cn(
            'flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-body-sm font-semibold transition-colors',
            mode === 'ai'
              ? 'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
              : 'text-[var(--color-content-muted)]',
          )}
        >
          <Sparkles size={13} /> {t('search.modeAskAi')}
        </button>
      </div>

      {mode === 'ai' ? (
        // AI mode is the single-field surface the toggle promises — no
        // Where/From/Until here at all, so there's nothing implying the
        // model does structured filtering it doesn't. A city/date match
        // from Search mode stays applied (parent state, untouched by this
        // toggle) and reaches the agent as `context.filters`; this field is
        // only for what a filter can't say.
        <div className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] py-1 pl-4 pr-1.5 shadow-[var(--shadow-float)]">
          <Sparkles size={16} className="shrink-0 text-[var(--color-accent-on)]" />
          <input
            ref={freeTextRef}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder={placeholder}
            aria-label="Describe the car you need"
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || !hasMessage}
            aria-label="Ask"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] disabled:opacity-40"
          >
            <Search size={16} />
          </button>
        </div>
      ) : (
      /* One row, every width — the same Where / From / Until / go layout on a
         phone as on a desktop, not a separate stacked mobile variant.
         Stacked four deep this bar ate 281px of a 459px hero at 390px, which
         is most of what a renter sees before scrolling; as one row it costs
         about a fifth of that. Everything that makes a single row fit on a
         narrow screen is a width concession, never a structural one: each
         segment is `min-w-0` so its text truncates instead of forcing the row
         wider than the screen, padding tightens, and the two extras that need
         room they don't have on a phone — the inline time selects and the
         locate button — wait for a container wide enough to hold them. Both
         remain reachable: "Current location" is the first row of the picker,
         and pickup time never filtered anything (there is no time-of-day
         field to filter on). */
      <div className="relative flex flex-nowrap items-stretch overflow-visible rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
        {/* Where */}
        <div
          ref={locationBoxRef}
          className="relative flex min-w-0 flex-[1.4] flex-col border-r border-[var(--color-line)] px-3 py-1 @md:flex-1 @md:px-4"
        >
          <span className="text-caption font-semibold text-[var(--color-content-muted)]">{t('search.where')}</span>
          <div className="flex items-center gap-2">
            <input
              value={locationText}
              onChange={(e) => onLocationTextChange(e.target.value)}
              onFocus={() => setSuggestOpen(true)}
              onKeyDown={(e) => e.key === 'Escape' && setSuggestOpen(false)}
              placeholder={t('search.wherePlaceholder')}
              aria-label="Pickup location"
              disabled={disabled}
              className="min-w-0 flex-1 truncate bg-transparent py-2.5 text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={useCurrentLocationClick}
              disabled={disabled || busyLocating}
              aria-label={t('search.useMyLocation')}
              // Visible at every width. Hiding it on phones to buy room for
              // the one-row bar was the wrong trade: "find cars near me" is
              // the single most likely thing a renter on a phone wants, and
              // it is the one control that can't be reached any other way
              // without first opening the picker. The Where placeholder
              // truncates a little sooner instead — the "Where" caption
              // above it already says what the field is for.
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-accent-on)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
            >
              {busyLocating ? <Spinner size={14} /> : <Navigation size={15} />}
            </button>
          </div>

          {suggestOpen && (
            // Full-width on a phone (there's nothing beside it to look narrow
            // against), but pinned to the Where segment's own width alone on
            // a wide screen reads as an unfinished sliver next to the rest of
            // the hero — a proper panel, like Turo's own, needs real width of
            // its own rather than borrowing whatever one field happens to be.
            <div className="absolute left-0 top-[calc(100%+8px)] z-[1100] max-h-[min(70vh,26rem)] w-full animate-popover-in overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-1.5 shadow-[var(--shadow-float)] @md:w-[420px]">
              <PickerRow
                icon={Navigation}
                title={busyLocating ? t('search.findingYou') : t('search.currentLocation')}
                onClick={useCurrentLocationClick}
                disabled={disabled || busyLocating}
              />
              <PickerRow
                icon={Globe}
                title={t('search.anywhere')}
                subtitle={t('search.anywhereSub')}
                onClick={pickAnywhere}
              />

              {showRecents && (
                <>
                  {/* A hairline between the two standing actions and the
                      renter's own history — the only divider in the panel,
                      because it's the only place the rows stop meaning the
                      same kind of thing. */}
                  <div className="my-1.5 border-t border-[var(--color-line)]" />
                  {recents.map((r, i) => (
                    <PickerRow
                      key={`${r.label}-${i}`}
                      icon={Clock}
                      title={splitAddress(r.label).name}
                      subtitle={r.dateLabel ?? splitAddress(r.label).context}
                      onClick={() => pickRecent(r)}
                    />
                  ))}
                </>
              )}

              {searching && (
                <p className="px-2.5 py-2 text-caption text-[var(--color-content-subtle)]">{t('search.searching')}</p>
              )}
              {suggestions.map((s, i) => {
                const { name, context } = splitAddress(s.label);
                return (
                  <PickerRow
                    key={`${s.lat},${s.lng},${i}`}
                    icon={KIND_ICONS[s.kind]}
                    title={name}
                    subtitle={context}
                    onClick={() => pickSuggestion(s)}
                  />
                );
              })}
              {suggestions.length > 0 && (
                <p className="px-2.5 pt-2 pb-1 text-center text-caption text-[var(--color-content-subtle)]">
                  {t('search.poweredByOsm')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* From + Until — two triggers, one shared calendar popover */}
        <div
          ref={datesBoxRef}
          className="relative flex min-w-0 flex-[1.1] flex-row divide-x divide-[var(--color-line)] @md:flex-[1.6]"
        >
          <div className="flex min-w-0 flex-1 flex-col px-3 py-1 @md:px-4">
            <span className="text-caption font-semibold text-[var(--color-content-muted)]">{t('search.from')}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDatesOpen((v) => !v)}
                disabled={disabled}
                className={cn(
                  // Truncates on a phone, where the row genuinely has no room; holds its
                  // full width once the time select appears beside it, since that
                  // select is `shrink-0` and would otherwise push the whole
                  // shortfall onto this label — "Add dates" clipped to "Add …".
                  'min-w-0 flex-1 truncate py-2.5 text-left text-body-sm font-medium @xl:min-w-max',
                  fromLabel ? 'text-[var(--color-content)]' : 'text-[var(--color-content-subtle)]',
                )}
              >
                {fromLabel ?? <EmptyDateLabel />}
              </button>
              {/* The pickup-time select is a nice-to-have that only earns
                  its width once there's real room for it — in the /ai
                  dock's own narrower dock it would otherwise squeeze "Add
                  dates" itself down to nothing. */}
              <span className="hidden items-center gap-1.5 @xl:flex">
                <span className="h-3.5 w-px shrink-0 bg-[var(--color-line)]" />
                <TimeSelect value={pickupTime} onChange={setPickupTime} placeholder={t('search.addTime')} disabled={disabled} />
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col px-3 py-1 @md:px-4">
            <span className="text-caption font-semibold text-[var(--color-content-muted)]">{t('search.until')}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDatesOpen((v) => !v)}
                disabled={disabled}
                className={cn(
                  // Truncates on a phone, where the row genuinely has no room; holds its
                  // full width once the time select appears beside it, since that
                  // select is `shrink-0` and would otherwise push the whole
                  // shortfall onto this label — "Add dates" clipped to "Add …".
                  'min-w-0 flex-1 truncate py-2.5 text-left text-body-sm font-medium @xl:min-w-max',
                  untilLabel ? 'text-[var(--color-content)]' : 'text-[var(--color-content-subtle)]',
                )}
              >
                {untilLabel ?? <EmptyDateLabel />}
              </button>
              <span className="hidden items-center gap-1.5 @xl:flex">
                <span className="h-3.5 w-px shrink-0 bg-[var(--color-line)]" />
                <TimeSelect value={returnTime} onChange={setReturnTime} placeholder={t('search.addTime')} disabled={disabled} />
              </span>
            </div>
          </div>

        </div>

        {/* Anchored to the whole bar, not to the From/Until segment.
            Those two segments share about half of a 390px bar — roughly
            190px — and a 7-column month grid crushed into that width
            collapses the day numbers into each other ("202 12 22 32 42 526").
            The calendar has nothing to do with the width of the control that
            opens it, so it spans the bar on a phone and only becomes a
            right-aligned two-month panel once there is room. */}
        {datesOpen && (
          <div
            ref={calendarRef}
            className="absolute inset-x-0 top-[calc(100%+8px)] z-[1100] animate-popover-in @md:left-auto @md:right-0 @md:w-[620px]"
          >
            {/* Two months on a wide screen, one on a phone —
                DateRangeCalendar already drops the second below `sm` itself.
                A rental range routinely crosses a month boundary, and with
                one month visible that means picking a start, paging forward,
                then picking an end with the start no longer on screen. */}
            <DateRangeCalendar
              value={dateRange}
              onChange={onDatesChange}
              minDate={todayIso()}
              isUnavailable={() => false}
              months={2}
            />
            <div className="mt-2 flex justify-end gap-2">
              {(dateRange.start || dateRange.end) && (
                <Button type="button" variant="ghost" size="sm" onClick={clearDates}>
                  {t('common.clear')}
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setDatesOpen(false)}>
                {t('common.done')}
              </Button>
            </div>
          </div>
        )}

        {/* Round search button */}
        <div className="flex items-center justify-center p-1.5 @md:pl-1">
          <button
            type="submit"
            disabled={disabled || !hasMessage}
            aria-label={t('search.submit')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] disabled:opacity-40"
          >
            <Search size={18} />
          </button>
        </div>
      </div>
      )}
    </form>
  );
});
