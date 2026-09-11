import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  BedDouble,
  Building2,
  ChevronDown,
  Clock,
  Globe,
  Info,
  MapPin,
  Navigation,
  Plane,
  Search,
  Sparkles,
  TrainFront,
  X,
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
import { saveHomeLocation } from '@/lib/homeLocation';
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
  /** Fires with the *coordinate* behind "Where" whenever there is a real one
   * — a picked suggestion, or the GPS fix behind "use my current location" —
   * and with `null` when there isn't (typed freehand, a recent, "anywhere").
   *
   * A coordinate is strictly better than the city name we can scrape out of
   * its label, so when one exists this bar reports it *instead of* a city:
   * `onCityMatch(undefined)` fires alongside. "Kigali" is a hard `.eq()` on
   * the city column, which is a boundary — stand near the edge of one and it
   * throws away the cars closest to you while keeping ones half an hour
   * further in. The coordinate is where the renter actually is, and it ranks
   * by real distance (`nearLat`/`nearLng`, migration 075) without excluding
   * anything. */
  onPointMatch?: (point: { lat: number; lng: number } | null) => void;
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
  /** Fired when the renter presses the search button in Search mode, with
   * whatever they typed. Filtering already happened live as they typed, so
   * this is not "run the search" — it is "take me to the results", and the
   * page decides where those are. Without it the button was inert: it closed
   * an open date picker and returned, which reads as broken.
   *
   * `point` is the coordinate behind `query` when there is one — a picked
   * suggestion, or the GPS fix behind "use my current location" — and it is
   * the half that actually answers "near me". Its label is a place *name*,
   * which the results page can only string-match back into a city; the
   * coordinate is what `nearLat`/`nearLng` need for migration 075's distance
   * sort, so dropping it here left "search from where I am" with nothing but
   * an address to grep. `null` when the renter typed a place freehand. */
  onSearch?: (input: {
    query: string;
    dateRange: DateRange;
    point: { lat: number; lng: number } | null;
  }) => void;
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
/** 48 half-hour slots, "9:00 AM" style — nobody picking up a rental needs
 * the minute.
 *
 * These render in the app's own popover rather than a native `<select>`.
 * A select's option list is drawn by the OS: it ignores the theme entirely,
 * so on a dark page it dropped a bright white system list over the hero and
 * looked like it belonged to a different app. The chrome is ours now; the
 * fixed increments are unchanged. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return { value: `${String(h24).padStart(2, '0')}:${m}`, label: formatTimeLabel(`${h24}:${m}`) };
});

/** Short, human label for the free-text prefix — "Kigali" out of a full
 * Nominatim address, or "your location" for a raw geolocated coordinate
 * that hasn't been reverse-geocoded (yet, or at all). */
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

/** Inner radius for anything sitting inside the bar's 4px inset, so the
 * corners run parallel to the bar's own instead of bulging against them. */
const INNER_RADIUS = 'rounded-[calc(var(--radius-card)-4px)]';

/** A segment's resting, hover and "its popover is open" looks. The open state
 * lifts the segment onto the sunken well, which is how the renter keeps track
 * of which field a floating panel belongs to. */
function segmentClass(active: boolean) {
  return cn(
    'relative flex min-w-0 items-center transition-colors',
    INNER_RADIUS,
    active ? 'bg-[var(--color-surface-sunken)]' : 'hover:bg-[var(--color-surface-sunken)]',
  );
}

const CAPTION = 'block text-caption font-medium text-[var(--color-content-subtle)]';

/** A hairline between segments. Fades while a neighbour is active, because a
 * divider drawn beside a filled segment reads as a stray mark. */
function SegmentDivider({ hidden }: { hidden?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('my-3 w-px shrink-0 bg-[var(--color-line)] transition-opacity', hidden && 'opacity-0')}
    />
  );
}

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
 * The icon sits in a quiet square tile rather than floating naked beside the
 * text: at eight rows the tiles form a single scannable column down the left
 * edge, which is what makes a list this long readable at a glance instead of
 * a wall of similar strings.
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
  emphasis,
}: {
  icon: typeof MapPin;
  title: ReactNode;
  subtitle?: string;
  onClick: () => void;
  disabled?: boolean;
  /** The standing "Current location" action — its tile takes the accent so
   * the one row that does something other than pick a string stands apart. */
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 text-left transition-colors hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
          emphasis
            ? 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
            : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
        )}
      >
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

function PanelHeading({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-1 pt-2.5 text-caption font-medium text-[var(--color-content-subtle)]">{children}</p>;
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
  up,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  /** Open the list upward — for a select at the bottom of a popover, where a
   * downward list would run off the bottom of the screen. */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = value ? formatTimeLabel(value) : placeholder;

  return (
    <div ref={boxRef} className="relative inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={placeholder}
        className={cn(
          'inline-flex w-[88px] items-center justify-between gap-1 rounded-[var(--radius-control)] py-1 text-left text-body-sm outline-none disabled:opacity-50',
          value ? 'text-[var(--color-content)]' : 'text-[var(--color-content-subtle)]',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className={cn('shrink-0 text-[var(--color-content-subtle)] transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'animate-popover-in absolute z-[1200] max-h-64 w-36 overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-1 shadow-[var(--shadow-float)]',
            up ? 'bottom-[calc(100%+6px)] left-0' : 'right-0 top-[calc(100%+10px)]',
          )}
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => { onChange(''); setOpen(false); }}
            className="flex w-full items-center rounded-[var(--radius-control)] px-2.5 py-2 text-left text-body-sm text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)]"
          >
            {placeholder}
          </button>
          {TIME_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="option"
              aria-selected={t.value === value}
              onClick={() => { onChange(t.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center rounded-[var(--radius-control)] px-2.5 py-2 text-left text-body-sm hover:bg-[var(--color-surface-sunken)]',
                t.value === value
                  ? 'bg-[var(--color-surface-inverse)] font-semibold text-[var(--color-content-inverse)]'
                  : 'text-[var(--color-content)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A dismissible line under the bar for what "use my location" could not do
 * silently. It sits on its own raised surface because the bar lives over a
 * photograph on Home, where bare caption text would vanish into the image. */
interface LocateNote {
  tone: 'error' | 'info';
  text: string;
}

/**
 * The compound search bar: Where / From / Until / search, one shared
 * component so Home's hero and /ai's field can never drift into two
 * different bars.
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
 * here claims a capability the app doesn't have: no time-of-day filtering
 * (no such field exists — pickup/return time is carried for a future booking
 * prefill, not used to narrow results).
 *
 * Visually it is one engineered object rather than a row of pills: a card
 * radius, a 4px inset, segments that fill on hover and while their popover
 * is open, and hairline dividers between them — restrained, in line with the
 * Inter Tight / Inter type the rest of the app now uses.
 */
export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar(
  {
    onSubmit,
    onCityMatch,
    onPointMatch,
    onDateRangeChange,
    onCountryMatch,
    onSearch,
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
  // and reaches the agent as `context.filters`.
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
  const [locateNote, setLocateNote] = useState<LocateNote | null>(null);

  const { locating, locate } = useMyLocation();
  // Covers the reverse-geocode network call too, which happens after the GPS
  // fix `locating` already tracks — without this the button would flash back
  // to idle between "found your GPS fix" and "found what that place is."
  const [resolvingPlace, setResolvingPlace] = useState(false);
  const busyLocating = locating || resolvingPlace;
  const { suggestions, searching } = useAddressSuggestions(locationText);

  const locationBoxRef = useRef<HTMLDivElement>(null);
  const suggestPanelRef = useRef<HTMLDivElement>(null);
  const datesBoxRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const freeTextRef = useRef<HTMLInputElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => freeTextRef.current?.focus() }));

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      // Trigger and panel both count as "inside" — each panel is a sibling of
      // its segment (anchored to the whole bar), not a descendant, so checking
      // only the segment would close it on the first click inside.
      const target = e.target as Node;
      if (!locationBoxRef.current?.contains(target) && !suggestPanelRef.current?.contains(target)) {
        setSuggestOpen(false);
      }
      if (!datesBoxRef.current?.contains(target) && !calendarRef.current?.contains(target)) {
        setDatesOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Typed freehand: no coordinate exists, so the city name matched out of the
  // text is the best "where" available and stays in charge.
  function onLocationTextChange(value: string) {
    setLocationText(value);
    setLocationPoint(null);
    setSuggestOpen(true);
    setLocateNote(null);
    onPointMatch?.(null);
    onCityMatch?.(matchKnownCity(value, country.code));
  }

  // A suggestion carries real coordinates from Nominatim, so the point wins
  // and the city its label happens to mention is dropped — see `onPointMatch`.
  function pickSuggestion(s: AddressSuggestion) {
    setLocationText(s.label);
    setLocationPoint({ lat: s.lat, lng: s.lng });
    setSuggestOpen(false);
    setLocateNote(null);
    onCityMatch?.(undefined);
    onPointMatch?.({ lat: s.lat, lng: s.lng });
  }

  // Recents keep only the label they were saved under, never a coordinate.
  function pickRecent(r: RecentSearch) {
    setLocationText(r.label);
    setLocationPoint(null);
    setSuggestOpen(false);
    setLocateNote(null);
    onPointMatch?.(null);
    onCityMatch?.(matchKnownCity(r.label, country.code));
  }

  function useCurrentLocationClick() {
    setLocateNote(null);
    locate(
      async (p) => {
        // Show the raw fix immediately — reverse geocoding is a second network
        // round trip, and the renter shouldn't stare at "Finding you…" for both
        // when the GPS fix alone is already worth showing.
        setLocationText(`Current location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
        setLocationPoint({ lat: p.lat, lng: p.lng });
        setSuggestOpen(false);
        // A network (IP) fix is city-level at best. Still worth using — it
        // ranks the right city's cars first — but said out loud, so nobody
        // wonders why "near me" is a few kilometres off.
        if (p.source === 'network') setLocateNote({ tone: 'info', text: t('search.approxLocation') });
        // The fix itself is the filter, from this moment on — the reverse
        // geocode below is only ever going to improve the *label*.
        onCityMatch?.(undefined);
        onPointMatch?.({ lat: p.lat, lng: p.lng });
        // Remembered so the next visit ranks by distance without asking again;
        // this is the same store Account → Your location writes.
        saveHomeLocation({ lat: p.lat, lng: p.lng, label: 'Current location' });

        setResolvingPlace(true);
        try {
          const resolved = await reverseGeocode(p.lat, p.lng);
          if (!resolved) return; // network/lookup failure — the raw fix stands.
          setLocationText(resolved.label);
          saveHomeLocation({ lat: p.lat, lng: p.lng, label: resolved.label });
          // Still no `onCityMatch` here: knowing the renter is in Kigali is no
          // reason to stop knowing *where* in Kigali. The market, though, is a
          // genuinely different question — a renter physically in another
          // country is browsing the wrong catalogue, not merely sorted oddly.
          if (resolved.countryCode && resolved.countryCode !== country.code) {
            onCountryMatch?.(resolved.countryCode);
          }
        } finally {
          setResolvingPlace(false);
        }
      },
      // Before this, a failure here did nothing at all: the spinner stopped
      // and the field stayed empty, which in Firefox — where the browser's
      // own provider can fail every time — looked like the page reloading.
      (reason) => {
        setSuggestOpen(false);
        setLocateNote({
          tone: 'error',
          text: reason === 'denied' ? t('search.locationDenied') : t('search.locationUnavailable'),
        });
        locationInputRef.current?.focus();
      },
    );
  }

  function pickAnywhere() {
    setLocationText('');
    setLocationPoint(null);
    setSuggestOpen(false);
    setLocateNote(null);
    onCityMatch?.(undefined);
    onPointMatch?.(null);
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
    // A city name is only "already a live filter" when it's the thing we
    // actually applied. With a coordinate in hand we deliberately apply the
    // point instead (see `onPointMatch`), so the place has to reach the agent
    // as prose — otherwise it would fall through the gap between a city
    // filter that was never set and prose that assumed it had been.
    const matchedCity = locationPoint ? undefined : matchKnownCity(loc, country.code);
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
      // each changes); the button's job is to take them to the results.
      setDatesOpen(false);
      setSuggestOpen(false);
      if (locationText.trim()) {
        const entry: RecentSearch = { label: locationText.trim(), dateLabel: formatDateRange(dateRange) ?? undefined };
        saveRecent(entry);
        setRecents(loadRecents());
      }
      onSearch?.({ query: locationText.trim(), dateRange, point: locationPoint });
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

  // Search mode's button is a "take me to results" action, not a submit gated
  // on content — the filtering already happened live. Only AI mode needs
  // something worth sending before it lights up.
  const hasMessage = mode === 'search' || !!composeMessage();
  const fromLabel = formatSingleDate(dateRange.start);
  const untilLabel = formatSingleDate(dateRange.end);
  const showRecents = locationText.trim().length === 0 && recents.length > 0;

  const modeButton = (value: 'search' | 'ai', icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={cn(
        'flex items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-body-sm font-medium transition-colors',
        mode === value
          ? 'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
          : 'text-[var(--color-content-muted)] hover:text-[var(--color-content)]',
      )}
    >
      {icon} {label}
    </button>
  );

  const dateTrigger = (caption: string, value: string | null, time: string) => (
    <button
      type="button"
      onClick={() => {
        setSuggestOpen(false);
        setDatesOpen((v) => !v);
      }}
      disabled={disabled}
      aria-expanded={datesOpen}
      className="flex min-w-0 flex-1 flex-col items-start py-2 text-left"
    >
      <span className={CAPTION}>{caption}</span>
      <span
        className={cn(
          'block w-full truncate text-body-sm font-medium',
          value ? 'text-[var(--color-content)]' : 'text-[var(--color-content-subtle)]',
        )}
      >
        {value ? (time ? `${value} · ${formatTimeLabel(time)}` : value) : <EmptyDateLabel />}
      </span>
    </button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn('@container flex flex-col gap-2', className)}
    >
      {/* The renter's own choice, front and centre — not a corner control
          easy to miss. A compact segmented control on its own raised surface,
          so it reads over a hero photograph as well as on a plain page. */}
      <div
        className={cn(
          'flex items-center gap-0.5 self-start rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-0.5 shadow-[var(--shadow-float)]',
          // On /ai there is nothing to toggle to — see `aiOnly`.
          aiOnly && 'hidden',
        )}
      >
        {modeButton('search', <Search size={13} />, t('search.modeSearch'))}
        {modeButton('ai', <Sparkles size={13} />, t('search.modeAskAi'))}
      </div>

      {mode === 'ai' ? (
        // AI mode is the single-field surface the toggle promises — no
        // Where/From/Until here at all, so there's nothing implying the
        // model does structured filtering it doesn't. A city/date match
        // from Search mode stays applied (parent state, untouched by this
        // toggle) and reaches the agent as `context.filters`; this field is
        // only for what a filter can't say.
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] p-1 pl-4 shadow-[var(--shadow-float)]">
          <Sparkles size={16} className="shrink-0 text-[var(--color-accent-on)]" />
          <input
            ref={freeTextRef}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder={placeholder}
            aria-label="Describe the car you need"
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent py-3 text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={disabled || !hasMessage}
            aria-label="Ask"
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40',
              INNER_RADIUS,
            )}
          >
            <Search size={17} />
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
         wider than the screen, padding tightens, and the inline time selects
         wait for a container wide enough to hold them (pickup time never
         filtered anything — there is no time-of-day field to filter on). */
      <div className="relative flex flex-nowrap items-stretch gap-0.5 rounded-[var(--radius-card)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] p-1 shadow-[var(--shadow-float)]">
        {/* Where */}
        <div
          ref={locationBoxRef}
          className={cn(segmentClass(suggestOpen), 'flex-[1.4] gap-1 pr-1 @md:flex-[1.2]')}
        >
          <label className="flex min-w-0 flex-1 cursor-text flex-col py-2 pl-3 @md:pl-4">
            <span className={CAPTION}>{t('search.where')}</span>
            <input
              ref={locationInputRef}
              value={locationText}
              onChange={(e) => onLocationTextChange(e.target.value)}
              onFocus={() => {
                setDatesOpen(false);
                setSuggestOpen(true);
              }}
              onKeyDown={(e) => e.key === 'Escape' && setSuggestOpen(false)}
              placeholder={t('search.wherePlaceholder')}
              aria-label="Pickup location"
              disabled={disabled}
              // `outline-none!`: the global :focus-visible ring is unlayered
              // CSS, so it beats a plain utility. The segment's own filled
              // state (the picker opens on focus) is the focus indicator here —
              // a ring drawn inside it boxed the text in twice.
              className="w-full min-w-0 truncate bg-transparent text-body-sm font-medium text-[var(--color-content)] outline-none! placeholder:font-normal placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
            />
          </label>
          <button
            type="button"
            onClick={useCurrentLocationClick}
            disabled={disabled || busyLocating}
            aria-label={t('search.useMyLocation')}
            title={t('search.useMyLocation')}
            // Visible at every width: "find cars near me" is the single most
            // likely thing a renter on a phone wants, and it shouldn't take
            // opening the picker first.
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-60"
          >
            {busyLocating ? <Spinner size={14} /> : <Navigation size={15} />}
          </button>
        </div>

        <SegmentDivider hidden={suggestOpen || datesOpen} />

        {/* From + Until — two triggers, one shared calendar popover. Pickup
            and return times live inside that popover rather than inline:
            inline they cost ~90px a side, which hid them on phones entirely
            and crowded the bar into "Add dates Add time ⌄" everywhere else. */}
        <div
          ref={datesBoxRef}
          className={cn(segmentClass(datesOpen), 'flex-[1.1] @md:flex-[1.6]')}
        >
          <div className="flex min-w-0 flex-1 px-3 @md:px-4">
            {dateTrigger(t('search.from'), fromLabel, pickupTime)}
          </div>
          <span aria-hidden className="my-3 w-px shrink-0 self-stretch bg-[var(--color-line)]" />
          <div className="flex min-w-0 flex-1 px-3 @md:px-4">
            {dateTrigger(t('search.until'), untilLabel, returnTime)}
          </div>
        </div>

        {/* Search */}
        <button
          type="submit"
          disabled={disabled || !hasMessage}
          aria-label={t('search.submit')}
          className={cn(
            'flex w-12 shrink-0 items-center justify-center self-stretch bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] transition-opacity hover:opacity-90 disabled:opacity-40 @md:w-14',
            INNER_RADIUS,
          )}
        >
          <Search size={18} />
        </button>

        {/* Both panels anchor to the whole bar, not the segment that opens
            them. The Where segment is under half of a 390px bar, and a list
            of full addresses — or a 7-column month grid — crushed into that
            width is unreadable. Full width on a phone; a panel of its own
            proper width once there is room. */}
        {suggestOpen && (
          <div
            ref={suggestPanelRef}
            className="absolute inset-x-0 top-[calc(100%+8px)] z-[1100] max-h-[min(70vh,26rem)] animate-popover-in overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-1.5 shadow-[var(--shadow-float)] @md:right-auto @md:w-[420px]"
          >
            <PickerRow
              icon={Navigation}
              emphasis
              title={busyLocating ? t('search.findingYou') : t('search.currentLocation')}
              subtitle={t('search.nearMe')}
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
                <div className="mx-2 mt-1.5 border-t border-[var(--color-line)]" />
                <PanelHeading>{t('search.recent')}</PanelHeading>
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

            {(searching || suggestions.length > 0) && (
              <div className="mx-2 mt-1.5 border-t border-[var(--color-line)]" />
            )}
            {searching && (
              <p className="flex items-center gap-2 px-2 py-2.5 text-caption text-[var(--color-content-subtle)]">
                <Spinner size={12} /> {t('search.searching')}
              </p>
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
              <p className="px-2 pb-1 pt-2 text-center text-caption text-[var(--color-content-subtle)]">
                {t('search.poweredByOsm')}
              </p>
            )}
          </div>
        )}

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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-2 pl-3 pr-2 shadow-[var(--shadow-float)]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-2">
                  <span className={CAPTION}>{t('search.pickupTime')}</span>
                  <TimeSelect up value={pickupTime} onChange={setPickupTime} placeholder={t('search.addTime')} disabled={disabled} />
                </span>
                <span className="flex items-center gap-2">
                  <span className={CAPTION}>{t('search.returnTime')}</span>
                  <TimeSelect up value={returnTime} onChange={setReturnTime} placeholder={t('search.addTime')} disabled={disabled} />
                </span>
              </div>
              <div className="flex gap-2">
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
          </div>
        )}
      </div>
      )}

      {locateNote && mode === 'search' && (
        <div
          role="status"
          className="flex max-w-full items-start gap-2 self-start rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-2 pl-3 pr-2 text-caption text-[var(--color-content-muted)] shadow-[var(--shadow-float)] animate-popover-in"
        >
          {locateNote.tone === 'error' ? (
            <AlertCircle size={14} className="mt-px shrink-0 text-[var(--color-danger-500)]" />
          ) : (
            <Info size={14} className="mt-px shrink-0 text-[var(--color-info-500)]" />
          )}
          <span className="min-w-0">{locateNote.text}</span>
          <button
            type="button"
            onClick={() => setLocateNote(null)}
            aria-label={t('search.dismiss')}
            className="-my-0.5 shrink-0 rounded-[var(--radius-pill)] p-0.5 text-[var(--color-content-subtle)] hover:text-[var(--color-content)]"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </form>
  );
});
