import { useNavigate } from 'react-router-dom';

/**
 * "Back to browse" that actually goes back — <ScrollMemory> plus each browse
 * page's own saved filters/page put the user back exactly where they left off
 * (same scroll offset, same page, same filters), instead of a fresh `Link to="/"`
 * push which lands at the top of a reset home page. Falls back to home if
 * there's no in-app history to go back to (e.g. a shared link opened directly).
 */
export function useBackToBrowse() {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };
}
