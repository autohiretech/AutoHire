import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DateRange {
  start: string | null;
  end: string | null;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Local yyyy-mm-dd (avoids the UTC shift `toISOString` introduces). */
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromIso(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function addDaysIso(s: string, n: number): string {
  const d = fromIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
/** Cells for a month: leading nulls for the first-of-month weekday, then ISO days. */
function monthCells(year: number, month: number): (string | null)[] {
  const startDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: startDay }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(iso(new Date(year, month, d)));
  return cells;
}

/**
 * Airbnb-style range picker. Renders `months` months side by side; click a start
 * day then a return day. Days before `minDate` or for which `isUnavailable`
 * returns true are disabled, and a range can't span an unavailable day.
 *
 * Pass `single` for a one-day pickup calendar (an hourly booking) instead of
 * a range — every click just moves the one selected day, rather than opening
 * a second click toward a range.
 */
export function DateRangeCalendar({
  value,
  onChange,
  minDate,
  isUnavailable,
  months = 2,
  single = false,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  minDate: string;
  isUnavailable: (isoDate: string) => boolean;
  months?: number;
  single?: boolean;
}) {
  const [cursor, setCursor] = useState(() => {
    const base = fromIso(value.start ?? minDate);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const minMonth = (() => {
    const d = fromIso(minDate);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  })();
  const canGoBack = cursor > minMonth;

  function rangeSpansUnavailable(a: string, b: string): boolean {
    for (let cur = addDaysIso(a, 1); cur < b; cur = addDaysIso(cur, 1)) {
      if (isUnavailable(cur)) return true;
    }
    return false;
  }

  function pick(day: string) {
    if (single) {
      onChange({ start: day, end: day });
      return;
    }
    const { start, end } = value;
    // Start a fresh selection on the first click, after a complete range, or
    // when clicking on/before the current start.
    if (!start || end || day <= start) {
      onChange({ start: day, end: null });
      return;
    }
    // Second click after a valid start — reject ranges crossing an unavailable day.
    if (rangeSpansUnavailable(start, day)) {
      onChange({ start: day, end: null });
      return;
    }
    onChange({ start, end: day });
  }

  const todayIso = iso(new Date());

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canGoBack && setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          disabled={!canGoBack}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-200 text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-200 text-ink-700 transition-colors hover:bg-ink-100"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className={cn('grid gap-x-8 gap-y-5', months > 1 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
        {Array.from({ length: months }).map((_, m) => {
          const month = new Date(cursor.getFullYear(), cursor.getMonth() + m, 1);
          const cells = monthCells(month.getFullYear(), month.getMonth());
          return (
            <div key={m} className={cn(m > 0 && 'hidden sm:block')}>
              <p className="mb-2.5 text-center text-sm font-semibold text-ink-900">
                {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
              </p>
              <div className="grid grid-cols-7 border-b border-ink-100 pb-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                {DAY_LABELS.map((d, i) => (
                  <span key={i} className="py-1">
                    {d}
                  </span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-y-1">
                {cells.map((day, i) => {
                  if (!day) return <span key={i} />;
                  const disabled = day < minDate || isUnavailable(day);
                  const isToday = day === todayIso;
                  const isStart = day === value.start;
                  const isEnd = day === value.end;
                  const inRange =
                    value.start && value.end && day > value.start && day < value.end;
                  const selectedEdge = isStart || isEnd;
                  return (
                    <div key={i} className="flex items-center justify-center py-0.5">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => pick(day)}
                        title={disabled ? 'Not available' : undefined}
                        className={cn(
                          'relative flex h-9 w-9 items-center justify-center text-sm font-medium transition-colors sm:h-10 sm:w-10',
                          !inRange && 'rounded-full',
                          disabled && 'cursor-not-allowed bg-ink-100 text-ink-400 line-through',
                          !disabled &&
                            !selectedEdge &&
                            !inRange &&
                            'text-ink-800 hover:bg-brand-50 hover:text-brand-700',
                          inRange && 'bg-brand-50 text-brand-700',
                          selectedEdge && 'bg-brand-600 font-semibold text-white shadow-sm',
                          isToday && !selectedEdge && 'ring-1 ring-inset ring-brand-400',
                        )}
                      >
                        {Number(day.slice(8))}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink-100 pt-3 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" /> {single ? 'Selected' : 'Selected dates'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-brand-400" /> Today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink-100 ring-1 ring-inset ring-ink-300" /> Unavailable
        </span>
      </div>
    </div>
  );
}
