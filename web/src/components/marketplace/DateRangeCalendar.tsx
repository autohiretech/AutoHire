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
 */
export function DateRangeCalendar({
  value,
  onChange,
  minDate,
  isUnavailable,
  months = 2,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  minDate: string;
  isUnavailable: (isoDate: string) => boolean;
  months?: number;
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canGoBack && setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          disabled={!canGoBack}
          className="rounded-full p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="rounded-full p-1.5 text-ink-600 hover:bg-ink-100"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className={cn('grid gap-x-8 gap-y-4', months > 1 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
        {Array.from({ length: months }).map((_, m) => {
          const month = new Date(cursor.getFullYear(), cursor.getMonth() + m, 1);
          const cells = monthCells(month.getFullYear(), month.getMonth());
          return (
            <div key={m} className={cn(m > 0 && 'hidden sm:block')}>
              <p className="mb-2 text-center text-sm font-semibold text-ink-900">
                {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
              </p>
              <div className="grid grid-cols-7 text-center text-[11px] font-medium text-ink-400">
                {DAY_LABELS.map((d, i) => (
                  <span key={i} className="py-1">
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((day, i) => {
                  if (!day) return <span key={i} />;
                  const disabled = day < minDate || isUnavailable(day);
                  const isStart = day === value.start;
                  const isEnd = day === value.end;
                  const inRange =
                    value.start && value.end && day > value.start && day < value.end;
                  const selectedEdge = isStart || isEnd;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled}
                      onClick={() => pick(day)}
                      className={cn(
                        'aspect-square text-sm transition-colors',
                        disabled && 'cursor-not-allowed text-ink-300 line-through',
                        !disabled && !selectedEdge && !inRange && 'text-ink-800 hover:bg-ink-100 rounded-full',
                        inRange && 'bg-brand-50 text-brand-700',
                        selectedEdge && 'bg-brand-600 font-semibold text-white rounded-full',
                      )}
                    >
                      {Number(day.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
