import { useEffect, useState } from 'react';

/**
 * What a phone's screen is actually showing, as opposed to the page's layout.
 *
 * When the on-screen keyboard opens, neither iOS Safari nor Chrome on Android
 * (by default) shrinks the layout: `100%`, `100vh` and `position: fixed;
 * bottom: 0` all still measure to the bottom of the screen *behind* the
 * keyboard. That is how a chat composer pinned to the bottom ends up hidden
 * the moment someone taps it. `window.visualViewport` is the one API that
 * reports the part left visible — its height, and on iOS how far Safari has
 * scrolled the page to keep the focused field in view.
 */
export interface VisualViewportState {
  /** Height of the visible area, px — shrinks while the keyboard is up. */
  height: number;
  /** How far the visible area is scrolled down inside the layout, px (iOS). */
  offsetTop: number;
  /** An editable field has focus and the visible area has lost keyboard-sized height. */
  keyboardOpen: boolean;
}

// The tallest the visible area has been at the current width. Comparing
// against the *layout* height doesn't work: with `interactive-widget=
// resizes-content` Android shrinks the layout too, so the two stay equal.
// A new width (rotation) starts a new baseline.
let tallest = 0;
let tallestAtWidth = 0;

/** Smaller than any phone keyboard, larger than a browser toolbar collapsing. */
const KEYBOARD_MIN_PX = 150;

function read(): VisualViewportState {
  const vv = window.visualViewport;
  const height = Math.round(vv?.height ?? window.innerHeight);
  const width = Math.round(vv?.width ?? window.innerWidth);
  if (width !== tallestAtWidth) {
    tallestAtWidth = width;
    tallest = height;
  }
  tallest = Math.max(tallest, height);

  const el = document.activeElement as HTMLElement | null;
  const editing =
    !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test((el as HTMLInputElement).type)));

  return {
    height,
    offsetTop: Math.round(vv?.offsetTop ?? 0),
    keyboardOpen: editing && tallest - height > KEYBOARD_MIN_PX,
  };
}

/**
 * Live `VisualViewportState`. Pass `enabled = false` to stop listening (the
 * last value is kept) — e.g. on desktop, where there is no keyboard to track.
 */
export function useVisualViewport(enabled = true): VisualViewportState {
  const [state, setState] = useState(read);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setState((prev) => {
          const next = read();
          return prev.height === next.height &&
            prev.offsetTop === next.offsetTop &&
            prev.keyboardOpen === next.keyboardOpen
            ? prev
            : next;
        }),
      );
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    // Focus decides `editing`, and focusing a field is what opens the keyboard.
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [enabled]);

  return state;
}

/** `window.matchMedia(query).matches`, kept live. */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
