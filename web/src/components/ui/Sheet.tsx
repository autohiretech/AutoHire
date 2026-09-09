import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A bottom sheet that shares the screen with whatever is behind it — on
 * mobile search, the map.
 *
 * **Why a sheet and not a tab.** The question a renter is actually asking is
 * "where is this car relative to me", and a tabbed map/list answers half of it
 * at a time. A sheet lets the map stay visible while the list is read, and
 * lets the list be dismissed to a peek without losing it. Turo and Getaround
 * both landed here independently.
 *
 * Three detents rather than free dragging: `peek` (the result count only),
 * `half`, and `full`. Free dragging on a list that also scrolls means every
 * gesture is ambiguous — the sheet steals scrolls meant for the list. Snapping
 * makes the two unambiguous: the handle drags, the body scrolls.
 */
export type SheetDetent = 'peek' | 'half' | 'full';

const detentClass: Record<SheetDetent, string> = {
  peek: 'h-[88px]',
  half: 'h-[55svh]',
  full: 'h-[92svh]',
};

export function Sheet({
  detent,
  onDetentChange,
  header,
  children,
  className,
}: {
  detent: SheetDetent;
  onDetentChange: (d: SheetDetent) => void;
  /** Always visible, even at `peek` — usually the result count. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const startY = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // Pointer events rather than touch events: the same handler then works for a
  // mouse on a narrow desktop window, which is how this gets tested most.
  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerUp(e: React.PointerEvent) {
    const from = startY.current;
    startY.current = null;
    setDragging(false);
    if (from === null) return;

    // A short flick is a full detent change; anything less is a tap, which
    // toggles between peek and half so the handle is useful without dragging.
    const dy = e.clientY - from;
    const order: SheetDetent[] = ['peek', 'half', 'full'];
    const i = order.indexOf(detent);
    if (dy < -40) onDetentChange(order[Math.min(i + 1, 2)]);
    else if (dy > 40) onDetentChange(order[Math.max(i - 1, 0)]);
    else onDetentChange(detent === 'peek' ? 'half' : 'peek');
  }

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 flex flex-col',
        'rounded-t-[var(--radius-sheet)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-sheet)]',
        !dragging && 'transition-[height] duration-300 ease-[var(--ease-sheet)]',
        detentClass[detent],
        className,
      )}
    >
      {/* The drag handle. `touch-none` stops the browser claiming the gesture
          for page scrolling before our pointer handlers see it. */}
      <div
        role="separator"
        aria-label="Resize results panel"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="flex cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
      >
        <span className="h-1 w-9 rounded-full bg-[var(--color-line-strong)]" />
      </div>

      {header && <div className="shrink-0 px-4 pb-2">{header}</div>}

      {/* At `peek` the sheet is a summary bar, so the body is hidden outright
          rather than clipped. `peek` is 88px and the handle plus header eat
          ~56px of it, which left a ~32px window showing the top third of the
          first listing card — a card sliced through its own photo reads as a
          rendering fault, not as "there is more below". Hidden, `peek` shows
          exactly what it means to: the count, and a handle to pull. */}
      <div
        className={cn(
          'min-h-0 flex-1',
          detent === 'peek' ? 'hidden' : 'overflow-y-auto overscroll-contain',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The floating pill that swaps the mobile results view between map and list.
 * Centred over the bottom of the map, above the sheet, because it is the one
 * control that is always available in both states.
 */
export function MapListToggle({
  showing,
  onToggle,
  className,
}: {
  showing: 'map' | 'list';
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5',
        'bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]',
        'text-body-sm font-semibold shadow-[var(--shadow-float)]',
        className,
      )}
    >
      {showing === 'map' ? 'List' : 'Map'}
    </button>
  );
}

/** Locks background scroll while a full-height sheet or modal is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
