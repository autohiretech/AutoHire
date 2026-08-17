import { useNavigate } from 'react-router-dom';

/**
 * "Back to browse" that actually goes back — <ScrollMemory> plus each browse
 * page's own saved filters/page put the user back exactly where they left off
 * (same scroll offset, same page, same filters), instead of a fresh `Link to="/"`
 * push which lands at the top of a reset home page. Falls back to home if
 * there's no in-app history to go back to (e.g. a shared link opened directly).
 *
 * Only takes that shortcut when the page being left is actually plausible as
 * "where I was browsing from", though — history.back() is happy to land on
 * /dashboard or /account just because that happened to be open right before
 * (the AI assistant's own "Continue on the car's page" can jump here from
 * anywhere), and neither reads as "back to browse" to a renter. Those fall
 * back to home instead, same as having no history at all.
 */
export function useBackToBrowse() {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    const prevPath = sessionStorage.getItem('autohire-prev-path');
    const prevIsBrowseSafe = !!prevPath && !prevPath.startsWith('/dashboard') && !prevPath.startsWith('/account');
    if (idx > 0 && prevIsBrowseSafe) navigate(-1);
    else navigate('/');
  };
}
