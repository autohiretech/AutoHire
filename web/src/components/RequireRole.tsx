import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import type { UserRole } from '@autohire/shared';
import { useAuth } from '@/lib/auth';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button, Notice, Spinner } from '@/components/ui';

/**
 * Gates a route to accounts whose profile role is in `roles`. Guests are sent
 * to /login (remembering where they were headed); signed-in users whose role
 * isn't allowed are sent home. Renders a spinner while the profile loads. This
 * complements RLS (the real boundary) by keeping host/admin pages off-limits in
 * the UI instead of rendering them empty.
 *
 * The profile query has three outcomes and each gets its own rendering,
 * because two of them used to share one:
 *
 * - **Loading** — spinner.
 * - **Loaded** — the role check. A wrong role redirects to `/`; a right one
 *   renders the page. A profile that loaded as *absent* (no row) also goes
 *   home: there is genuinely no role to admit.
 * - **Errored** — an inline notice with Retry, and the person stays put.
 *
 * The old code collapsed the last two: `if (!profile) <Navigate to="/" />`
 * ran the moment `isLoading` went false, and it goes false on an error as
 * surely as on an answer. So a network blip, a 5xx, a slow Edge Function or a
 * token mid-refresh on the profile request sent a host with a fleet to the
 * renter homepage — "Become a host" in the header, no message, no way back but
 * a reload. A check that FAILED was rendered as a check that said NO.
 * Unreachable is not the same as absent, and on the one fact this app holds
 * about a person that decides which app they see, the difference has to be
 * drawn here. (PayHold's Overview and Rails screens had the same bug and the
 * same fix this week; this is its AutoHire twin.)
 *
 * The app's query client has `retry: false` (see `lib/queryClient.ts`), so
 * at this layer one failed request is the error state. What smooths a blip
 * over is postgrest-js itself, which retries an idempotent GET three times
 * (1s/2s/4s) on network errors and 5xx before rejecting — so the notice
 * appears after roughly seven seconds of failure, not on the first miss, and
 * the Retry button is the recovery from there short of a reload.
 */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const { data: profile, isPending, isError, isFetching, refetch } = useCurrentUser();

  // Not signed in — send to login so they can create an account or sign in.
  if (!loading && !user) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }

  // A loaded profile is an answer, and the role check is the only thing that
  // may act on it. This comes before the error branch on purpose: React Query
  // keeps `data` when a *background* refetch fails, and a host who already
  // has a page open should not be shown "we couldn't load your account" —
  // let alone be sent home — because a refresh of a fact we already hold
  // happened to miss. Stale-but-real beats an honest shrug here.
  if (profile) {
    if (!roles.includes(profile.role)) {
      return <Navigate to="/" replace />;
    }
    return <>{children}</>;
  }

  // The request failed and there is no earlier answer to fall back on. Say
  // so, in place, with a way to try again. Not a redirect (that is what
  // turned a blip into "you are a renter now"), and not "not authorised" —
  // nothing was decided about this person; nothing was reached.
  if (isError) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <Notice tone="warn" role="alert" className="flex-col items-start gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">We couldn't load your account just now.</p>
              <p className="mt-0.5">
                This page needs to know who you are before it can open. Nothing about your
                account has changed — this is usually a connection hiccup.
              </p>
            </div>
          </div>
          {/* `outline`, not `primary`: the accent is for the action a page
              exists to do, and this page has not opened yet. Disabled while
              the retry is in flight so a second tap cannot queue a second
              request behind the first. */}
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="ml-[30px]"
          >
            {isFetching && <Spinner size="sm" />}
            {isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </Notice>
      </div>
    );
  }

  // Still waiting: on the session, or on the first answer from the profile
  // query. (`isPending` is React Query's "no data and no error yet"; it is
  // deliberately not `isLoading`, which is also false while a query is merely
  // disabled — that case is already handled by the /login redirect above.)
  if (loading || isPending) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  // Loaded, and there is no profile row for this session. That is an actual
  // "no": there is no role to admit, so home is the honest place to land.
  return <Navigate to="/" replace />;
}
