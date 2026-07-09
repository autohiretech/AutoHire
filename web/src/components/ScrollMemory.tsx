import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Remembers scroll position per history entry, so returning to a page (browser
 * Back, or a `navigate(-1)`) lands where you left off instead of at the top —
 * while a fresh forward navigation still starts at the top.
 *
 * Because content can render after a fetch (e.g. the paginated browse grid), a
 * saved position is re-applied on a short retry loop until the page is tall
 * enough to reach it. Mounted once in AppLayout (which outlives route changes).
 */
export function ScrollMemory() {
  const { key } = useLocation();
  // While we're programmatically restoring, don't overwrite the saved value.
  const restoringUntil = useRef(0);

  useEffect(() => {
    // Take over scroll handling from the browser so it doesn't fight our restore.
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    const storeKey = `scroll:${key}`;
    const saved = sessionStorage.getItem(storeKey);
    let raf = 0;

    if (saved != null) {
      const target = parseInt(saved, 10);
      const deadline = Date.now() + 2000;
      restoringUntil.current = deadline;
      const step = () => {
        window.scrollTo(0, target);
        if (Date.now() < deadline && Math.abs(window.scrollY - target) > 2) {
          raf = requestAnimationFrame(step);
        } else {
          restoringUntil.current = 0;
        }
      };
      raf = requestAnimationFrame(step);
    } else {
      restoringUntil.current = 0;
      window.scrollTo(0, 0);
    }

    const onScroll = () => {
      if (Date.now() < restoringUntil.current) return;
      sessionStorage.setItem(storeKey, String(window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [key]);

  return null;
}
