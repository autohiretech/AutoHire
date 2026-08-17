import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, History, MessageCircle, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/currency';
import { timeAgo } from '@/lib/format';
import { listingHeadlinePrice } from '@/lib/pricing';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCountry } from '@/lib/country';
import { useAiAssistantContext } from '@/lib/aiAssistantContext';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { Spinner, toast } from '@/components/ui';

type BotTurn = {
  id: number;
  query: string;
  status: 'thinking' | 'done';
  reply: string | null;
  /** The cars a filter change actually matched, so the renter can see them
   * without looking away from the chat — same ones get highlighted on the
   * map and list behind the panel, when the current page has one. Unset
   * until the context's listings catch up with the new filters. */
  matches: Listing[] | null;
  /** Set whenever the model identifies a car to book, whatever it does or
   * doesn't yet know about dates/time/hours. The chat never completes a
   * booking itself — no payment method, no pay button, nothing PayHold-
   * shaped ever renders inside this panel. This is strictly a handoff: pick
   * (or accept) the details, then continue on the car's own page, where the
   * real checkout already lives with room to actually use it. */
  bookingPrompt: BookingPrompt | null;
};

type BookingPrompt = {
  listing: Listing;
  rentalType: 'daily' | 'hourly';
  startDate: string | null;
  endDate: string | null;
  pickupTime: string | null;
  estimatedHours: number | null;
};

// Survives navigating away and back, a hard refresh, or reopening the tab
// later — localStorage, not sessionStorage, so it's the browser that owns
// the lifetime, not the tab. Only a fresh conversation (no turns) clears the
// stored key; it doesn't expire on its own. One global assistant now, so
// this is the only chat — no more per-page keys to keep in sync.
const CHAT_STORAGE_KEY = 'autohire-ai-chat';

function loadStoredChat(): { turns: BotTurn[]; open: boolean } {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return { turns: [], open: false };
    const parsed = JSON.parse(raw) as { turns: BotTurn[]; open: boolean };
    return { turns: parsed.turns ?? [], open: !!parsed.open };
  } catch {
    return { turns: [], open: false };
  }
}

/**
 * The floating AI assistant — mounted once, in AppLayout, so it's on every
 * page rather than scoped to search. It reads which cars are "in view" (and,
 * where a page registered them, how to act on a filter change or a
 * highlight) from AiAssistantContext instead of props: a car's own detail
 * page publishes just that one listing and no handlers, so "book this one"
 * resolves against it directly without the renter ever having to search
 * first. A page with no handler registered (anywhere but /search) still
 * gets useful filter behavior — the assistant just navigates to /search
 * with what it understood, rather than updating in-place list+map state
 * that only /search actually has.
 */
export function AiAssistant() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { country, setCountry, currencies, setCurrency } = useCountry();
  const {
    contextListings: results,
    resultsLoading,
    activeFilters,
    handlers,
    registerSelectForBooking,
  } = useAiAssistantContext();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  // A car's own page has its own mobile-only sticky Reserve bar pinned to
  // bottom-0 (CarDetailPage's `lg:hidden` bar) — below the `lg` breakpoint
  // this bubble's usual bottom-5 sits right on top of that button's tap
  // target, at a higher z-index, so the renter's tap opens the assistant
  // instead of reserving the car. Lifting clear of it below `lg`, where the
  // conflict actually exists, and dropping back to bottom-5 at `lg` and up,
  // where CarDetailPage's bar is hidden.
  const liftAboveStickyBar = pathname.startsWith('/cars/');

  const stored = useRef(loadStoredChat()).current;
  const [open, setOpen] = useState(stored.open);
  const [turns, setTurns] = useState<BotTurn[]>(stored.turns);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const nextId = useRef(stored.turns.reduce((max, t) => Math.max(max, t.id), 0) + 1);
  const endRef = useRef<HTMLDivElement>(null);
  const locationAsked = useRef(false);
  // The DB row (migration 073) this conversation is saved as, once it has
  // one — null until either a stored conversation loads with an id, or the
  // first turn of a brand new one gets saved. localStorage (`stored` above)
  // is still what paints instantly on mount; this is what makes the same
  // conversation available on another device or after clearing the browser.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const hydratedFromDb = useRef(false);
  // True once DB hydration has either run and settled, or been determined
  // unnecessary (no signed-in profile) — see the hydration effect below for
  // why the auto-ask effect waits on this before firing.
  const [dbHydrated, setDbHydrated] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; updatedAt: string; preview: string | null }[]>([]);
  // A filter-applying turn's matches aren't known until the context's own
  // listings (a page's own query, or a fresh /search after a fallback
  // navigate) catch up with the new filters — this holds which turn is
  // waiting so the effect below can fill it in.
  const pendingMatchId = useRef<number | null>(null);
  // Set when a map pin (or similar) is clicked, so the very next thing the
  // renter types ("book it", "message the host") resolves to that exact car
  // without relying on the model inferring "it" from conversation history —
  // consumed once, then cleared, so it doesn't keep biasing later, unrelated
  // turns.
  const lastSelectedListingId = useRef<string | null>(null);

  // ?bot=1 opens the assistant from a link, on whichever page it lands on.
  // Paired with ?ask=, it also asks that text right away — Home's search bar
  // is now a straight "ask AI" entry point, not a plain filter box, so
  // landing here should show the assistant already working on it rather
  // than an empty panel the renter has to type into again. Deliberately a
  // separate param from `q` — `q` also drives SearchResultsPage's own plain
  // keyword filter (interpretQuery), and letting that fire off the same
  // text would race the AI's own read of it and flash its own guess first.
  // Guarded to fire once: without the ref, this would re-ask on every
  // unrelated re-render that happens to still carry the same URL. Also
  // waits on `dbHydrated` — see the hydration effect below for why: firing
  // before it settles risks the real conversation history overwriting this
  // turn out from under it a moment later.
  const autoAskedRef = useRef(false);
  useEffect(() => {
    const wantsBot = searchParams.get('bot') === '1';
    if (wantsBot) setOpen(true);
    const askText = searchParams.get('ask');
    if (wantsBot && askText && dbHydrated && !autoAskedRef.current) {
      autoAskedRef.current = true;
      void ask(askText);
    }
  }, [searchParams, dbHydrated]);

  // The renter's own upcoming/past trips — so "cancel my Friday one" has
  // something to resolve against. Same query key BookingPage uses, so a
  // cancellation here also updates it if it's open elsewhere.
  const { data: myTrips } = useQuery({
    queryKey: ['bookings'],
    queryFn: () => client.listBookings(),
    enabled: !!me,
  });

  useEffect(() => {
    if (open)
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, open]);

  // Keep the conversation across a navigate-away-and-back, a hard refresh, or
  // closing and reopening the tab — instant, before the DB round trip below
  // even starts.
  useEffect(() => {
    try {
      if (turns.length === 0) localStorage.removeItem(CHAT_STORAGE_KEY);
      else localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ turns, open }));
    } catch {
      // localStorage unavailable (private mode, quota) — the chat still
      // works this visit, it just won't survive leaving the page.
    }
  }, [turns, open]);

  // The DB row is the real source of truth once signed in — this pulls
  // whatever the renter's most recent conversation actually is (possibly
  // from another device) the first time `me` is available, overwriting
  // whatever localStorage happened to restore. Runs once: after that, this
  // tab's own `turns` state drives what gets saved, not the other way round.
  //
  // `dbHydrated` flips true once this has either run (and settled) or been
  // determined unnecessary (no signed-in profile). The auto-ask effect below
  // waits on it deliberately — without that gate, a query typed on Home would
  // land here, start a turn and an in-flight ask() immediately, and then get
  // silently wiped out a moment later when this effect's `setTurns(restored)`
  // overwrote it with last visit's saved conversation. Gating means the real
  // history is always in place first, and a fresh query always lands as a new
  // turn appended after it, same as any other follow-up.
  useEffect(() => {
    if (meLoading) return;
    if (!me) {
      setDbHydrated(true);
      return;
    }
    if (hydratedFromDb.current) return;
    hydratedFromDb.current = true;
    client
      .getLatestChatSession()
      .then((session) => {
        if (!session || session.turns.length === 0) return;
        const restored = session.turns as BotTurn[];
        setTurns(restored);
        setSessionId(session.id);
        nextId.current = restored.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      })
      .catch(() => {})
      .finally(() => setDbHydrated(true));
  }, [me, meLoading]);

  // Saves every change to the DB too — upsert, so the first turn of a brand
  // new conversation (sessionId still null) creates its row here rather than
  // needing a separate "create" round trip first.
  useEffect(() => {
    if (!me || turns.length === 0) return;
    const id = sessionId ?? `chat-${Date.now()}`;
    if (!sessionId) setSessionId(id);
    client.saveChatSession(id, turns).catch(() => {});
  }, [turns, me, sessionId]);

  // A restored conversation's last matches aren't reflected on whichever
  // page mounts first — this re-applies the highlight once, from whichever
  // turn set it, if the page that mounts registers a highlight handler.
  useEffect(() => {
    const lastWithMatches = [...stored.turns].reverse().find((t) => t.matches && t.matches.length > 0);
    if (lastWithMatches?.matches) handlers.current.onHighlight?.(lastWithMatches.matches.map((l) => l.id));
    // Intentionally mount-only: `stored` is captured once via useRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask for location the first time the assistant is opened, not on page
  // load — a renter who never touches the assistant is never prompted.
  useEffect(() => {
    if (!open || locationAsked.current || !navigator.geolocation) return;
    locationAsked.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, // denied or unavailable — the assistant just goes without it
      { timeout: 8000 },
    );
  }, [open]);

  // Once the context's listings settle under the new filters — either the
  // current page's own query, or a fresh /search page after the fallback
  // navigate below — pull the first few matches into the waiting turn and
  // highlight them wherever the current page can, so the renter sees what
  // changed without looking away from the conversation.
  useEffect(() => {
    if (resultsLoading) return;
    const id = pendingMatchId.current;
    if (id == null) return;
    pendingMatchId.current = null;
    const matches = results.slice(0, 4);
    setTurns((t) =>
      t.map((turn) =>
        turn.id === id
          ? {
              ...turn,
              matches,
              // "Here you go." (set back in ask(), before the real count was
              // known) is actively misleading on an empty result — say so
              // plainly instead, and offer the one thing that actually helps.
              reply:
                results.length === 0
                  ? "Couldn't find anything matching that — want me to drop a filter, or widen the search?"
                  : turn.reply,
            }
          : turn,
      ),
    );
    handlers.current.onHighlight?.(matches.map((l) => l.id));
  }, [results, resultsLoading, handlers]);

  async function ask(raw: string, selectedListingId?: string) {
    const query = raw.trim();
    if (!query || busy) return;
    setInput('');
    setBusy(true);
    const id = nextId.current++;
    setTurns((t) => [
      ...t,
      { id, query, status: 'thinking', reply: null, matches: null, bookingPrompt: null },
    ]);

    const history = turns.flatMap(
      (t): { role: 'user' | 'assistant'; text: string }[] => [
        { role: 'user' as const, text: t.query },
        ...(t.reply ? [{ role: 'assistant' as const, text: t.reply }] : []),
      ],
    );
    const recentListings = results.map((l) => ({
      id: l.id,
      title: l.title,
      rentalType: l.pricingMode,
    }));
    const recentTrips = (myTrips ?? []).map((b) => ({
      id: b.id,
      listingId: b.listingId,
      startDate: b.startDate,
      endDate: b.endDate,
      state: b.state,
    }));

    try {
      const res = await client.aiSearch({
        query,
        history,
        recentListings,
        recentTrips,
        location,
        country: country.code,
        profile: me
          ? { name: me.fullName, verification: me.verification, accountCountry: me.country ?? null }
          : null,
        availableCurrencies: currencies.map((c) => c.currency),
        selectedListingId,
        currentFilters: activeFilters,
      });
      if (res.filters) {
        const onFilters = handlers.current.onFilters;
        if (onFilters) {
          onFilters(res.filters, res.clearFilters);
        } else {
          // No page has registered filter handling (we're not on /search) —
          // the only thing that actually applies a filter change is that
          // page's own state, so take the renter there instead of quietly
          // doing nothing.
          navigate(`/search?q=${encodeURIComponent(res.filters.query || query)}`);
        }
        pendingMatchId.current = id;
      }

      const notes: string[] = [];

      // A booking may name a listing this conversation already showed, or —
      // since the renter can ask to book any car by name — one it didn't;
      // fetch it directly in that case rather than refusing.
      // The chat never completes a booking — it identifies the car and
      // pre-fills whatever it already knows, then hands off to that car's
      // own page for the actual checkout (see BookingPromptForm's one
      // button). Populated as soon as a listing resolves, whether or not
      // dates/time/hours are known yet.
      let bookingPrompt: BookingPrompt | null = null;
      if (res.booking) {
        const listing =
          results.find((l) => l.id === res.booking!.listingId) ??
          (await client.getListing(res.booking.listingId).catch(() => null));
        if (listing) {
          // The listing's own pricingMode is the one fact the model can't
          // get wrong here — it's not a judgment call, so it overrides
          // whatever rentalType the model guessed rather than being
          // cross-checked against it.
          const rentalType = listing.pricingMode;
          const { startDate, endDate, pickupTime, estimatedHours } = res.booking;
          let finalStart = startDate ?? null;
          let finalEnd = rentalType === 'daily' && endDate !== startDate ? (endDate ?? null) : null;

          // The model has no way to know a car's actual booked dates — it
          // isn't given them, and shouldn't be trusted to remember them
          // correctly turn to turn even if it were. Checked here instead,
          // against the same data CarDetailPage's own calendar reads, right
          // before the date would otherwise get pre-filled into the form.
          if (finalStart) {
            const proposedEnd = rentalType === 'daily' ? (finalEnd ?? finalStart) : finalStart;
            try {
              const bookedRanges = await client.getBookedRanges(listing.id);
              const conflict = bookedRanges.find((r) => finalStart! <= r.endDate && r.startDate <= proposedEnd);
              if (conflict) {
                notes.push(
                  `${listing.title} is already booked ${conflict.startDate} to ${conflict.endDate} — want different dates?`,
                );
                finalStart = null;
                finalEnd = null;
              }
            } catch {
              // Availability check itself failed (network, RLS, whatever) —
              // don't block booking over a check that couldn't run; the
              // renter still hits the same conflict on the car's own page
              // if it's real.
            }
          }

          bookingPrompt = {
            listing,
            rentalType,
            startDate: finalStart,
            endDate: finalEnd,
            pickupTime: pickupTime ?? null,
            estimatedHours: rentalType === 'hourly' ? (estimatedHours ?? null) : null,
          };
          handlers.current.onHighlight?.([listing.id]);
        }
      }
      if (res.messageHost) {
        try {
          const listing =
            results.find((l) => l.id === res.messageHost!.listingId) ??
            (await client.getListing(res.messageHost.listingId));
          if (!listing || !me) throw new Error('listing or profile unavailable');
          const conv = await client.getOrCreateConversation(listing.id, me.id, listing.hostId);
          await client.sendMessage(conv.id, res.messageHost.message);
          notes.push('Message sent to the host.');
          // Land the renter in the actual thread rather than leaving the
          // confirmation as just a line of text in the assistant panel —
          // wherever they asked from, including the dashboard.
          navigate(`/messages/${conv.id}`);
        } catch {
          notes.push("Couldn't send that message.");
        }
      }
      if (res.watchlist) {
        try {
          if (res.watchlist.action === 'add') await client.watchListing(res.watchlist.listingId);
          else await client.unwatchListing(res.watchlist.listingId);
          await queryClient.invalidateQueries({ queryKey: ['watchedListings'] });
          await queryClient.invalidateQueries({ queryKey: ['watchlist'] });
          notes.push(res.watchlist.action === 'add' ? 'Added to your watchlist.' : 'Removed from your watchlist.');
        } catch {
          notes.push("Couldn't update your watchlist.");
        }
      }
      if (res.cancelTrip) {
        try {
          const outcome = await client.cancelBooking(res.cancelTrip.bookingId);
          await queryClient.invalidateQueries({ queryKey: ['bookings'] });
          notes.push(outcome.cancelled ? 'Trip cancelled.' : (outcome.message ?? 'Cancellation is pending.'));
        } catch {
          notes.push("Couldn't cancel that trip.");
        }
      }
      if (res.updateProfile) {
        try {
          await client.updateProfile(res.updateProfile);
          await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
          // The account country and the header's browsing market are two
          // different pieces of state — keep them in sync rather than
          // leaving the header showing somewhere the renter just said
          // they're no longer in.
          if (res.updateProfile.country) setCountry(res.updateProfile.country);
          const changed = [
            res.updateProfile.fullName && 'name',
            res.updateProfile.country && 'country',
          ].filter(Boolean);
          notes.push(changed.length ? `Updated your ${changed.join(' and ')}.` : 'Profile updated.');
        } catch {
          notes.push("Couldn't update your profile.");
        }
      }
      if (res.setCurrency) {
        setCurrency(res.setCurrency.currencyCode);
        notes.push(`Now showing prices in ${res.setCurrency.currencyCode}.`);
      }

      setTurns((t) =>
        t.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                status: 'done',
                reply:
                  [res.reply, ...notes].filter(Boolean).join(' ') ||
                  (bookingPrompt ? "Let's get that booked:" : res.filters ? 'Here you go.' : null),
                bookingPrompt,
              }
            : turn,
        ),
      );
    } catch (err) {
      setTurns((t) =>
        t.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                status: 'done',
                reply: "Something went wrong. Let's try that again.",
              }
            : turn,
        ),
      );
      toast.error(
        err instanceof Error ? err.message : 'AI search is unavailable.',
      );
    } finally {
      setBusy(false);
    }
  }

  // Lets a map marker (or anything else outside the chat) "select" a car for
  // booking — opens the panel and runs the exact same request a renter
  // typing "book this one" would, so there's one booking path, not two.
  // Re-registers every render, deliberately with no dependency array — `ask`
  // is a plain function redeclared each render, closing over that render's
  // `turns`/`busy`/etc, and a limited dep list here would freeze whichever
  // one happened to be current the first time this ran.
  useEffect(() => {
    registerSelectForBooking((listing) => {
      setOpen(true);
      lastSelectedListingId.current = listing.id;
      // Deliberately not a call to ask() — clicking a car isn't a booking
      // request yet, it's "tell me about this one." Building the turn
      // directly, with the listing data already in hand, means this is
      // instant and always correct, rather than routing a synthetic message
      // through the model and hoping it doesn't jump straight to
      // start_booking on its own. Booking only actually starts once the
      // renter says so themselves, as a normal follow-up.
      const price = listingHeadlinePrice(listing);
      const info = [
        `${listing.ratingAvg.toFixed(1)}★ (${listing.ratingCount})`,
        formatMoney(price.amount, listing.priceCurrency) + ' / ' + price.unit,
        listing.location,
      ].join(' · ');
      const turnId = nextId.current++;
      setTurns((t) => [
        ...t,
        {
          id: turnId,
          query: listing.title,
          status: 'done',
          reply: `${info}\n\nWant to book it, or see the full listing?`,
          matches: [listing],
          bookingPrompt: null,
        },
      ]);
    });
  });

  // Starts a fresh conversation rather than continuing the restored one — no
  // DB row is created until the first real message (the save effect above
  // handles that itself), so clicking this and never typing anything leaves
  // nothing behind.
  function startNewChat() {
    setTurns([]);
    setSessionId(null);
    nextId.current = 1;
    setHistoryOpen(false);
  }

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) setSessions(await client.listChatSessions().catch(() => []));
  }

  async function switchToSession(id: string) {
    const session = await client.getChatSession(id).catch(() => null);
    if (session) {
      const loaded = session.turns as BotTurn[];
      setTurns(loaded);
      setSessionId(session.id);
      nextId.current = loaded.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    }
    setHistoryOpen(false);
  }

  async function deleteSession(id: string) {
    await client.deleteChatSession(id).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // Deleting the conversation that's currently open leaves nothing valid
    // to keep showing — drop back to a blank new chat rather than a stale
    // one pointed at a row that no longer exists.
    if (id === sessionId) {
      setTurns([]);
      setSessionId(null);
      nextId.current = 1;
    }
  }

  return (
    <>
      {/* Bubble — opens the panel; closing is the panel's own header X, so this
          never doubles as a close button. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className={cn(
            'fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-lg transition-transform hover:scale-105',
            liftAboveStickyBar ? 'bottom-24 lg:bottom-5' : 'bottom-5',
          )}
        >
          <MessageCircle size={22} />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className={cn(
            'fixed right-5 z-40 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl',
            liftAboveStickyBar ? 'bottom-24 lg:bottom-5' : 'bottom-5',
          )}
        >
          <div className="flex items-center gap-2 border-b border-ink-100 bg-brand-50/60 px-4 py-3">
            <Sparkles size={16} className="text-brand-600" />
            <p className="text-sm font-semibold text-ink-900">
              AutoHire assistant
            </p>
            <div className="ml-auto flex items-center gap-1">
              {me && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => void toggleHistory()}
                    aria-label="Past chats"
                    className="rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                  >
                    <History size={16} />
                  </button>
                  {historyOpen && (
                    <div className="absolute right-0 top-8 z-10 max-h-72 w-64 overflow-y-auto rounded-xl border border-ink-100 bg-white p-1.5 shadow-lg">
                      {sessions.length === 0 ? (
                        <p className="p-2 text-xs text-ink-400">No past chats yet.</p>
                      ) : (
                        sessions.map((s) => (
                          <div
                            key={s.id}
                            className={cn(
                              'group flex items-center gap-0.5 rounded-lg transition-colors hover:bg-ink-50',
                              s.id === sessionId && 'bg-brand-50/70',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => void switchToSession(s.id)}
                              className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs"
                            >
                              <span className={cn('block truncate', s.id === sessionId ? 'text-brand-700' : 'text-ink-700')}>
                                {s.preview ?? 'New chat'}
                              </span>
                              <span className="text-[11px] text-ink-400">{timeAgo(s.updatedAt)}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSession(s.id)}
                              aria-label="Delete this chat"
                              className="shrink-0 rounded-full p-1.5 text-ink-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              {me && (
                <button
                  type="button"
                  onClick={startNewChat}
                  aria-label="New chat"
                  className="rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                >
                  <Plus size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close AI assistant"
                className="rounded-full p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <>
                <p className="text-sm text-ink-500">
                  Ask for what you need, or tell me to book one of the cars you're
                  looking at.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-50"
                >
                  Search manually instead
                </button>
              </>
            )}
            {turns.map((t) => (
              <div key={t.id}>
                <p className="rounded-2xl rounded-tr-sm bg-brand-50 px-3 py-1.5 text-sm text-brand-800">
                  {t.query}
                </p>
                {t.status === 'thinking' ? (
                  <p className="mt-1.5 text-sm text-ink-400">Thinking…</p>
                ) : (
                  <>
                    {t.reply && (
                      <p className="mt-1.5 whitespace-pre-line text-sm text-ink-800">{t.reply}</p>
                    )}
                    {t.matches && t.matches.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {t.matches.map((listing) => (
                          <MatchCard key={listing.id} listing={listing} />
                        ))}
                      </div>
                    )}
                    {t.bookingPrompt && (
                      <div className="mt-2">
                        <BookingPromptForm
                          prompt={t.bookingPrompt}
                          onContinue={(values) => {
                            const { listing, rentalType } = t.bookingPrompt!;
                            const params = new URLSearchParams();
                            if (values.startDate) params.set('start', values.startDate);
                            if (rentalType === 'daily' && values.endDate) params.set('end', values.endDate);
                            if (values.pickupTime) params.set('pickup', values.pickupTime);
                            if (rentalType === 'hourly' && values.estimatedHours) {
                              params.set('hours', String(values.estimatedHours));
                            }
                            navigate(`/cars/${listing.id}?${params.toString()}`);
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const selectedListingId = lastSelectedListingId.current ?? undefined;
              lastSelectedListingId.current = null;
              void ask(input, selectedListingId);
            }}
            className="flex items-center gap-2 border-t border-ink-100 p-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up…"
              aria-label="Message the AI assistant"
              className="w-full min-w-0 flex-1 rounded-full border border-ink-200 px-3.5 py-2 text-sm outline-none focus:border-brand-400"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40"
            >
              {busy ? <Spinner size={14} /> : <ArrowRight size={16} />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/** Real date/time/hours inputs, not another round of "what time works for
 * you?" — the assistant already knows this is a booking and which car; all
 * that's actually missing is precision a typed sentence makes the model
 * guess at. "Open car page" hands the same values to the real booking form
 * (CarDetailPage reads them from the URL) for a renter who'd rather finish
 * there than in a 22rem-wide panel. */
/** Real date/time/hours inputs, not another round of "what time works for
 * you?" — the assistant already knows this is a booking and which car; all
 * that's actually missing is precision a typed sentence makes the model
 * guess at. There's exactly one button: this panel never completes a
 * booking itself, it hands the same values to the real booking form on the
 * car's own page (CarDetailPage reads them from the URL), where the actual
 * checkout — payment method, PayHold, all of it — already lives with room
 * to use it. */
function BookingPromptForm({
  prompt,
  onContinue,
}: {
  prompt: BookingPrompt;
  onContinue: (values: {
    startDate: string;
    endDate: string | null;
    pickupTime: string;
    estimatedHours: number | null;
  }) => void;
}) {
  const { listing, rentalType } = prompt;
  const [startDate, setStartDate] = useState(prompt.startDate ?? '');
  const [endDate, setEndDate] = useState(prompt.endDate ?? '');
  const [pickupTime, setPickupTime] = useState(prompt.pickupTime ?? '10:00');
  const [hours, setHours] = useState(prompt.estimatedHours ?? 4);

  const valid =
    rentalType === 'hourly'
      ? !!startDate && !!pickupTime && hours > 0
      : !!startDate && !!endDate && startDate !== endDate && !!pickupTime;

  const price = listingHeadlinePrice(listing);
  const units = rentalType === 'hourly' ? hours : startDate && endDate ? days(startDate, endDate) : 0;
  const estimatedTotal = units > 0 ? formatMoney(price.amount * units, listing.priceCurrency) : null;

  return (
    <div className="space-y-2 rounded-xl border-2 border-brand-200 bg-brand-50/40 p-3">
      <div className="flex items-center gap-2.5">
        <Img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-11 w-16 shrink-0 rounded-lg object-cover"
        />
        <p className="min-w-0 truncate text-xs font-semibold text-ink-900">{listing.title}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] text-ink-500">
          {rentalType === 'hourly' ? 'Pickup date' : 'Start date'}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-900 outline-none focus:border-brand-400"
          />
        </label>
        {rentalType === 'daily' ? (
          <label className="block text-[11px] text-ink-500">
            Return date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-900 outline-none focus:border-brand-400"
            />
          </label>
        ) : (
          <label className="block text-[11px] text-ink-500">
            Hours needed
            <input
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))}
              className="mt-0.5 w-full rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-900 outline-none focus:border-brand-400"
            />
          </label>
        )}
        <label className="col-span-2 block text-[11px] text-ink-500">
          Pickup time
          <input
            type="time"
            value={pickupTime}
            onChange={(e) => setPickupTime(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-900 outline-none focus:border-brand-400"
          />
        </label>
      </div>
      {estimatedTotal && (
        <p className="text-xs font-medium text-ink-700">Estimated total: {estimatedTotal}</p>
      )}
      <button
        type="button"
        disabled={!valid}
        onClick={() =>
          onContinue({
            startDate,
            endDate: rentalType === 'daily' ? endDate : null,
            pickupTime,
            estimatedHours: rentalType === 'hourly' ? hours : null,
          })
        }
        className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
      >
        Continue on the car's page
      </button>
    </div>
  );
}

/** A filter turn's actual matches, shown inline so the renter can see what
 * changed without looking past the panel — the same cars are highlighted on
 * the map and list behind it, where the current page has one. Links out to
 * the real listing page like any other result. */
function MatchCard({ listing }: { listing: Listing }) {
  const price = listingHeadlinePrice(listing);
  const { data: me } = useCurrentUser();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);

  // A sibling button overlaid on the card, not nested inside the Link —
  // a <button> inside an <a> is invalid HTML and behaves inconsistently
  // across browsers. Same pattern MessagesPage's own delete button uses.
  async function messageHost() {
    if (!me || messaging) return;
    setMessaging(true);
    try {
      const conv = await client.getOrCreateConversation(listing.id, me.id, listing.hostId);
      navigate(`/messages/${conv.id}`);
    } catch {
      toast.error("Couldn't open that chat.");
    } finally {
      setMessaging(false);
    }
  }

  return (
    <div className="relative">
      <Link
        to={`/cars/${listing.id}`}
        className="flex items-center gap-2.5 rounded-xl border-2 border-brand-200 bg-brand-50/40 p-2 pr-9 transition-colors hover:border-brand-400 hover:bg-brand-50/70"
      >
        <Img
          src={listing.photos[0]}
          alt={listing.title}
          className="h-11 w-16 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-ink-900">{listing.title}</p>
          <p className="text-xs text-ink-500">
            <Price amount={price.amount} currency={listing.priceCurrency} />
            <span> / {price.unit}</span>
          </p>
        </div>
      </Link>
      {me && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void messageHost();
          }}
          disabled={messaging}
          aria-label={`Message ${listing.title}'s host`}
          title="Message the host"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-ink-400 transition-colors hover:bg-white hover:text-brand-600 disabled:opacity-50"
        >
          <MessageCircle size={15} />
        </button>
      )}
    </div>
  );
}

function days(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}
