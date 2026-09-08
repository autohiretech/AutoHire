import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown, Globe, MapPin, Navigation, Search, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Spinner } from '@/components/ui';
import { useAddressSuggestions, type AddressSuggestion } from '@/lib/geocoding';
import { useMyLocation } from '@/lib/useMyLocation';
import { useCountry } from '@/lib/country';
import { citiesFor } from '@/lib/cities';
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
  initialValue?: string;
  placeholder?: string;
  disabled?: boolean;
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

function matchCity(text: string, country: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return citiesFor(country).find((c) => t.includes(c.toLowerCase()));
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
    initialValue = '',
    placeholder = 'Anything else? SUV, under 150k, automatic…',
    disabled = false,
    className,
  },
  ref,
) {
  const { country } = useCountry();

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
  const { suggestions, searching } = useAddressSuggestions(locationText);

  const locationBoxRef = useRef<HTMLDivElement>(null);
  const datesBoxRef = useRef<HTMLDivElement>(null);
  const freeTextRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => freeTextRef.current?.focus() }));

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (locationBoxRef.current && !locationBoxRef.current.contains(e.target as Node)) setSuggestOpen(false);
      if (datesBoxRef.current && !datesBoxRef.current.contains(e.target as Node)) setDatesOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function onLocationTextChange(value: string) {
    setLocationText(value);
    setLocationPoint(null);
    setSuggestOpen(true);
    onCityMatch?.(matchCity(value, country.code));
  }

  function pickSuggestion(s: AddressSuggestion) {
    setLocationText(s.label);
    setLocationPoint({ lat: s.lat, lng: s.lng });
    setSuggestOpen(false);
    onCityMatch?.(matchCity(s.label, country.code));
  }

  function pickRecent(r: RecentSearch) {
    setLocationText(r.label);
    setLocationPoint(null);
    setSuggestOpen(false);
    onCityMatch?.(matchCity(r.label, country.code));
  }

  function useCurrentLocationClick() {
    locate((p) => {
      setLocationText(`Current location (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
      setLocationPoint(p);
      setSuggestOpen(false);
      // No reverse geocoding in this app — a raw coordinate can't be matched
      // to a known city, so any earlier match is cleared rather than left stale.
      onCityMatch?.(undefined);
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
    const matchedCity = matchCity(loc, country.code);
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
    const message = composeMessage();
    if (!message) return;
    onSubmit({
      message,
      location: locationPoint ? { ...locationPoint, label: locationText.trim() } : undefined,
      dateRange: dateRange.start ? dateRange : undefined,
    });
    if (locationText.trim()) {
      const entry: RecentSearch = { label: locationText.trim(), dateLabel: formatDateRange(dateRange) ?? undefined };
      saveRecent(entry);
      setRecents(loadRecents());
    }
    setFreeText('');
  }

  const hasMessage = !!composeMessage();
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
      <div className="flex flex-col divide-y divide-[var(--color-line)] overflow-visible rounded-[var(--radius-sheet)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)] @md:flex-row @md:items-stretch @md:divide-y-0 @md:divide-x @md:rounded-[var(--radius-pill)]">
        {/* Where */}
        <div ref={locationBoxRef} className="relative flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2 @md:py-1.5">
          <span className="text-caption font-semibold text-[var(--color-content-muted)]">Where</span>
          <div className="flex items-center gap-2">
            <input
              value={locationText}
              onChange={(e) => onLocationTextChange(e.target.value)}
              onFocus={() => setSuggestOpen(true)}
              onKeyDown={(e) => e.key === 'Escape' && setSuggestOpen(false)}
              placeholder="Airport, hotel, address, city"
              aria-label="Pickup location"
              disabled={disabled}
              className="min-w-0 flex-1 bg-transparent text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={useCurrentLocationClick}
              disabled={disabled || locating}
              aria-label="Use my current location"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-accent-on)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
            >
              {locating ? <Spinner size={14} /> : <Navigation size={15} />}
            </button>
          </div>

          {suggestOpen && (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1100] max-h-72 animate-popover-in overflow-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-float)]">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={useCurrentLocationClick}
                disabled={disabled || locating}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
              >
                <Navigation className="h-4 w-4 shrink-0 text-[var(--color-accent-on)]" />
                {locating ? 'Finding you…' : 'Current location'}
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={pickAnywhere}
                className="flex w-full items-center gap-2 border-t border-[var(--color-line)] px-3 py-2 text-left text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]"
              >
                <Globe className="h-4 w-4 shrink-0 text-[var(--color-content-subtle)]" />
                Anywhere — Browse all cars
              </button>

              {showRecents &&
                recents.map((r, i) => (
                  <button
                    key={`${r.label}-${i}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickRecent(r)}
                    className="flex w-full items-start gap-2 border-t border-[var(--color-line)] px-3 py-2 text-left text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-content-subtle)]" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1">{r.label}</span>
                      {r.dateLabel && (
                        <span className="block text-caption text-[var(--color-content-subtle)]">{r.dateLabel}</span>
                      )}
                    </span>
                  </button>
                ))}

              {searching && (
                <div className="border-t border-[var(--color-line)] px-3 py-2 text-caption text-[var(--color-content-subtle)]">
                  Searching…
                </div>
              )}
              {suggestions.map((s, i) => (
                <button
                  key={`${s.lat},${s.lng},${i}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-start gap-2 border-t border-[var(--color-line)] px-3 py-2 text-left text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-content-subtle)]" />
                  <span className="line-clamp-2">{s.label}</span>
                </button>
              ))}
              {suggestions.length > 0 && (
                <p className="border-t border-[var(--color-line)] px-3 py-1.5 text-caption text-[var(--color-content-subtle)]">
                  Powered by OpenStreetMap
                </p>
              )}
            </div>
          )}
        </div>

        {/* From + Until — two triggers, one shared calendar popover */}
        <div
          ref={datesBoxRef}
          className="relative flex min-w-0 flex-col divide-y divide-[var(--color-line)] @md:flex-[1.6] @md:flex-row @md:divide-y-0 @md:divide-x"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2 @md:py-1.5">
            <span className="text-caption font-semibold text-[var(--color-content-muted)]">From</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDatesOpen((v) => !v)}
                disabled={disabled}
                className={cn(
                  'shrink-0 whitespace-nowrap text-body-sm font-medium',
                  fromLabel ? 'text-[var(--color-content)]' : 'text-[var(--color-content-subtle)]',
                )}
              >
                {fromLabel ?? 'Add dates'}
              </button>
              {/* The pickup-time select is a nice-to-have that only earns
                  its width once there's real room for it — in the /ai
                  dock's own narrower dock it would otherwise squeeze "Add
                  dates" itself down to nothing. */}
              <span className="flex items-center gap-1.5 @md:hidden @xl:flex">
                <span className="h-3.5 w-px shrink-0 bg-[var(--color-line)]" />
                <TimeSelect value={pickupTime} onChange={setPickupTime} placeholder="Add time" disabled={disabled} />
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2 @md:py-1.5">
            <span className="text-caption font-semibold text-[var(--color-content-muted)]">Until</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDatesOpen((v) => !v)}
                disabled={disabled}
                className={cn(
                  'shrink-0 whitespace-nowrap text-body-sm font-medium',
                  untilLabel ? 'text-[var(--color-content)]' : 'text-[var(--color-content-subtle)]',
                )}
              >
                {untilLabel ?? 'Add dates'}
              </button>
              <span className="flex items-center gap-1.5 @md:hidden @xl:flex">
                <span className="h-3.5 w-px shrink-0 bg-[var(--color-line)]" />
                <TimeSelect value={returnTime} onChange={setReturnTime} placeholder="Add time" disabled={disabled} />
              </span>
            </div>
          </div>

          {datesOpen && (
            <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[1100] animate-popover-in @md:left-auto @md:right-0 @md:w-[340px]">
              <DateRangeCalendar
                value={dateRange}
                onChange={onDatesChange}
                minDate={todayIso()}
                isUnavailable={() => false}
                months={1}
              />
              <div className="mt-2 flex justify-end gap-2">
                {(dateRange.start || dateRange.end) && (
                  <Button type="button" variant="ghost" size="sm" onClick={clearDates}>
                    Clear
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => setDatesOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Round search button */}
        <div className="flex items-center justify-center p-1.5 @md:pl-1">
          <button
            type="submit"
            disabled={disabled || !hasMessage}
            aria-label="Search"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] disabled:opacity-40"
          >
            <Search size={18} />
          </button>
        </div>
      </div>

      {/* Free text — a subtler row below the pill, not a fifth field
          crowding it. Still the one thing that reads as prose to the agent;
          Where/From/Until above are either a real filter (a matched city) or
          carried intent folded into `message`, never claimed to filter
          anything themselves. */}
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-3.5 py-2">
        <Sparkles size={15} className="shrink-0 text-[var(--color-accent-on)]" />
        <input
          ref={freeTextRef}
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder={placeholder}
          aria-label="Anything else"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] disabled:opacity-60"
        />
        {freeText && (
          <button
            type="button"
            onClick={() => setFreeText('')}
            aria-label="Clear"
            className="shrink-0 text-[var(--color-content-subtle)] hover:text-[var(--color-content)]"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </form>
  );
});
