import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Search, Send } from 'lucide-react';
import type { AdminSupportThread } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { formatDate, timeAgo } from '@/lib/format';
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

/** One conversation: every message, then a box to answer it. */
function ThreadView({ thread }: { thread: AdminSupportThread }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const messages = useQuery({
    queryKey: ['supportMessages', thread.id],
    queryFn: () => client.listSupportMessages(thread.id),
  });

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

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar name={thread.fullName} src={thread.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-h4 text-[var(--color-content)]">{thread.fullName}</h2>
            <p className="truncate text-body-sm text-[var(--color-content-muted)]">{thread.email}</p>
            <p className="mt-1 truncate text-caption text-[var(--color-content-subtle)]">
              {thread.subject} · started {formatDate(thread.lastMessageAt)}
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
      </Card>

      <Card className="p-4 sm:p-5">
        {messages.isLoading ? (
          <div className="flex justify-center py-6"><Spinner size={18} /></div>
        ) : messages.isError ? (
          // A failed read used to render as an empty conversation, which reads
          // as "they never wrote anything" — the opposite of what happened.
          <p className="py-6 text-center text-body-sm text-[var(--color-danger-500)]">
            Couldn&apos;t load this conversation.{' '}
            <button type="button" className="underline" onClick={() => void messages.refetch()}>
              Try again
            </button>
          </p>
        ) : (messages.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-body-sm text-[var(--color-content-muted)]">
            No messages in this conversation yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {(messages.data ?? []).map((m) => (
              <li
                key={m.id}
                className={cn(
                  'max-w-[80%] rounded-[var(--radius-card)] px-3.5 py-2.5 text-body-sm',
                  m.fromAdmin
                    ? 'ml-auto bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
                    : 'bg-[var(--color-surface-sunken)] text-[var(--color-content)]',
                )}
              >
                <p className="whitespace-pre-line">{m.body}</p>
                <p className={cn('mt-1 text-caption', m.fromAdmin ? 'text-[var(--color-accent-contrast)]/70' : 'text-[var(--color-content-subtle)]')}>
                  {m.fromAdmin ? 'AutoHire' : thread.fullName.split(' ')[0]} · {timeAgo(m.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={`Reply to ${thread.fullName.split(' ')[0]}…`}
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!body.trim() || reply.isPending} onClick={() => reply.mutate()}>
              <Send size={14} /> {reply.isPending ? 'Sending…' : 'Send reply'}
            </Button>
            <span className="text-caption text-[var(--color-content-subtle)]">
              Replying reopens a closed conversation.
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
