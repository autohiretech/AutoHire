import { Fragment, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Search, Send } from 'lucide-react';
import type { AdminSupportThread } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatDate, formatDayLabel, formatTime, timeAgo } from '@/lib/format';
import { Avatar, Badge, Button, Card, Chip, Input, Skeleton, Spinner, toast } from '@/components/ui';

const PAGE_SIZE = 20;

/**
 * Admin → Messages: the other end of "Message this user".
 *
 * Sending someone a message used to be the end of the exchange — they read it
 * and had nowhere to answer. Now a message opens a conversation, and this is
 * where the answers arrive. Same shape as the verification queue: the list on
 * the left keeps its place while one conversation is read on the right.
 *
 * Conversations waiting on an admin sort first (the server orders by unread,
 * then recency), so working top-down is the same as answering oldest-waiting
 * first.
 */
export function MessagesSection() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openOnPhone, setOpenOnPhone] = useState(false);

  const query = useQuery({
    queryKey: ['supportThreads', scope, term, page],
    queryFn: () => client.listSupportThreads({ scope, search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const threads = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const selected = threads.find((t) => t.id === selectedId) ?? threads[0];

  // The sidebar badge counts conversations waiting on us; reading one changes
  // that, so keep the two in step.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['supportWaiting'] });
  }, [selected?.id, qc]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <Card className={cn('overflow-hidden lg:sticky lg:top-4', openOnPhone && 'hidden lg:block')}>
        <div className="space-y-3 border-b border-[var(--color-line)] p-3">
          <div className="flex gap-1.5">
            <Chip selected={scope === 'open'} onClick={() => { setScope('open'); setPage(0); setSelectedId(null); }}>
              Open
            </Chip>
            <Chip selected={scope === 'all'} onClick={() => { setScope('all'); setPage(0); setSelectedId(null); }}>
              All
            </Chip>
          </div>
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(search);
              setPage(0);
              setSelectedId(null);
            }}
          >
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" className="pl-9" />
          </form>
          <p className="tabular px-0.5 text-caption text-[var(--color-content-subtle)]">
            {query.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'conversation' : 'conversations'}`}
          </p>
        </div>

        <div className="p-1.5 lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto">
          {query.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))
          ) : threads.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CheckCircle2 size={22} className="mx-auto text-[var(--color-accent-on)]" />
              <p className="mt-2 text-body-sm font-medium text-[var(--color-content)]">
                {scope === 'open' ? 'No open conversations.' : 'No conversations yet.'}
              </p>
              <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                One starts when you message someone from Users, or when they write to AutoHire.
              </p>
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setSelectedId(t.id); setOpenOnPhone(true); }}
                aria-current={t.id === selected?.id}
                className={cn(
                  'flex w-full items-start gap-3 rounded-[var(--radius-control)] px-2.5 py-2.5 text-left transition-colors',
                  t.id === selected?.id
                    ? 'bg-[var(--color-surface-sunken)] shadow-[inset_3px_0_0_var(--color-accent-on)]'
                    : 'hover:bg-[var(--color-surface-sunken)]',
                )}
              >
                <Avatar name={t.fullName} src={t.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-body-sm font-medium text-[var(--color-content)]">{t.fullName}</span>
                    <span className="shrink-0 text-caption text-[var(--color-content-subtle)]">{timeAgo(t.lastMessageAt)}</span>
                  </span>
                  <span className="block truncate text-caption text-[var(--color-content-subtle)]">
                    {t.lastFromAdmin ? 'You: ' : ''}
                    {t.lastMessagePreview}
                  </span>
                </span>
                {t.unreadForAdmin > 0 && <Badge tone="warn" className="tabular shrink-0">{t.unreadForAdmin}</Badge>}
                {t.status === 'closed' && <Badge tone="neutral" className="shrink-0">Closed</Badge>}
              </button>
            ))
          )}
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-[var(--color-line)] px-3 py-2">
            <Button variant="ghost" size="sm" disabled={page === 0 || query.isFetching} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft size={16} />
            </Button>
            <span className="tabular text-caption text-[var(--color-content-subtle)]">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <Button variant="ghost" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || query.isFetching} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </Card>

      <div className={cn('min-w-0', !openOnPhone && 'hidden lg:block')}>
        <button
          type="button"
          onClick={() => setOpenOnPhone(false)}
          className="mb-3 inline-flex items-center gap-1.5 text-body-sm font-medium text-[var(--color-content-muted)] lg:hidden"
        >
          <ArrowLeft size={16} /> Back to the list
        </button>
        {selected ? (
          <ThreadView key={selected.id} thread={selected} />
        ) : (
          !query.isLoading && (
            <Card className="hidden px-6 py-16 text-center text-body-sm text-[var(--color-content-muted)] lg:block">
              Pick a conversation to read it.
            </Card>
          )
        )}
      </div>
    </div>
  );
}

/**
 * One conversation, built like the messenger it is rather than a stack of
 * cards: a fixed header, a scrolling transcript, and a composer pinned to the
 * bottom. It used to be two cards with the reply box below the messages, so a
 * long conversation pushed the thing you came here to do off the screen.
 *
 * The transcript deliberately matches the renter's own thread in
 * MessagesPage — same bubble shape, same day pills, same in-bubble clock —
 * because it is the same conversation seen from the other end, and two
 * different-looking halves of one exchange is what made this screen feel
 * unfinished. That includes the colour rule written there: an admin's own
 * messages are `surface-inverse`, never the brand green. The accent is spent
 * once per screen, on the send button.
 */
function ThreadView({ thread }: { thread: AdminSupportThread }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = useQuery({
    queryKey: ['supportMessages', thread.id],
    queryFn: () => client.listSupportMessages(thread.id),
  });
  const items = messages.data ?? [];

  // Land on the newest message, the way every messenger does — and again after
  // sending, so your own reply is what you are looking at.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items.length, messages.isLoading]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['supportMessages', thread.id] });
    void qc.invalidateQueries({ queryKey: ['supportThreads'] });
    void qc.invalidateQueries({ queryKey: ['supportWaiting'] });
  };

  const reply = useMutation({
    mutationFn: () => client.replyToSupportThread(thread.id, body.trim()),
    onSuccess: () => {
      setBody('');
      refresh();
      toast.success(`Sent to ${thread.fullName}. They get a notification.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send that."),
  });
  const setClosed = useMutation({
    mutationFn: (closed: boolean) => client.setSupportThreadClosed(thread.id, closed),
    onSuccess: (_r, closed) => {
      refresh();
      toast.success(closed ? 'Conversation closed.' : 'Conversation reopened.');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't change that."),
  });

  // When the conversation actually started, taken from the first message.
  // The header used to label `lastMessageAt` as "started", which is the one
  // date it is not — on a live conversation it moves every time someone
  // writes.
  const startedAt = items[0]?.createdAt;

  return (
    <Card className="flex flex-col overflow-hidden lg:h-[calc(100vh-8rem)]">
      <div className="flex shrink-0 items-start gap-3 border-b border-[var(--color-line)] p-4 sm:px-5">
        <Avatar name={thread.fullName} src={thread.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-h4 text-[var(--color-content)]">{thread.fullName}</h2>
            {thread.status === 'closed' && <Badge tone="neutral">Closed</Badge>}
          </div>
          <p className="truncate text-body-sm text-[var(--color-content-muted)]">{thread.email}</p>
          <p className="mt-1 truncate text-caption text-[var(--color-content-subtle)]">
            {thread.subject}
            {startedAt ? ` · started ${formatDate(startedAt)}` : ''}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={setClosed.isPending}
          onClick={() => setClosed.mutate(thread.status !== 'closed')}
        >
          {thread.status === 'closed' ? (<><RotateCcw size={14} /> Reopen</>) : 'Close'}
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain bg-[var(--color-surface)] p-4 max-lg:max-h-[55svh]"
      >
        {messages.isLoading ? (
          <div className="flex flex-1 items-center justify-center py-6"><Spinner size={18} /></div>
        ) : messages.isError ? (
          // A failed read used to render as an empty conversation, which reads
          // as "they never wrote anything" — the opposite of what happened.
          <p className="my-auto text-center text-body-sm text-[var(--color-danger-500)]">
            Couldn&apos;t load this conversation.{' '}
            <button type="button" className="underline" onClick={() => void messages.refetch()}>
              Try again
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="my-auto text-center text-body-sm text-[var(--color-content-muted)]">
            No messages in this conversation yet.
          </p>
        ) : (
          // `mt-auto` sits the transcript on the composer when there is not
          // enough of it to fill the pane. Without it a two-message
          // conversation hangs at the top of a full-height card with a hole
          // under it. It is the safe half of this trick: `justify-end` on the
          // scroller itself makes overflowing content unreachable above the
          // top edge, whereas an auto margin collapses to nothing as soon as
          // the list is taller than the pane.
          <div className="mt-auto flex flex-col gap-1.5">
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay =
              !prev ||
              new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-caption text-[var(--color-content-muted)]">
                      {formatDayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    'flex max-w-[78%] flex-col',
                    m.fromAdmin ? 'items-end self-end' : 'items-start self-start',
                  )}
                >
                  <div
                    className={cn(
                      'rounded-[var(--radius-card)] px-3.5 py-2 text-body-sm',
                      m.fromAdmin
                        ? 'rounded-br-sm bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
                        : // A hairline edge, which the renter's own thread does without:
                          // there the sunken bubble sits on a page that is a
                          // shade lighter, and here it sits on the transcript's
                          // own surface. In dark mode those two are close
                          // enough that an incoming message read as loose text
                          // with no bubble around it at all.
                          'rounded-bl-sm border border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-[var(--color-content)]',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {/* Who said it is answered by which side it sits on, so the
                        bubble carries a clock and nothing else. Every bubble
                        used to repeat "AutoHire ·" or the person's first name. */}
                    <span
                      className={cn(
                        'tabular mt-1 flex justify-end text-[10px]',
                        m.fromAdmin
                          ? 'text-[var(--color-content-inverse)]/70'
                          : 'text-[var(--color-content-subtle)]',
                      )}
                    >
                      {formatTime(m.createdAt)}
                    </span>
                  </div>
                </div>
              </Fragment>
            );
          })}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim() && !reply.isPending) reply.mutate();
        }}
        className="flex shrink-0 items-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface-raised)] p-3"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline — the same contract as the
            // renter's composer, and what anyone typing in a message box
            // expects. `isComposing` keeps an IME's Enter out of it.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={`Reply to ${thread.fullName.split(' ')[0]}…`}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-[var(--radius-card)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)]"
        />
        <button
          type="submit"
          // Keeps focus in the textarea, so sending doesn't dismiss the
          // keyboard on a touch screen mid-conversation.
          onPointerDown={(e) => e.preventDefault()}
          disabled={!body.trim() || reply.isPending}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] disabled:opacity-40"
          aria-label={reply.isPending ? 'Sending' : 'Send reply'}
        >
          <Send size={18} />
        </button>
      </form>

      {thread.status === 'closed' && (
        <p className="shrink-0 border-t border-[var(--color-line)] bg-[var(--color-surface-raised)] px-3 pb-3 text-caption text-[var(--color-content-subtle)]">
          Replying reopens this conversation.
        </p>
      )}
    </Card>
  );
}
