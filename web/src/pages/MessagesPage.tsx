import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCheck, MessageSquare, Search, Send } from 'lucide-react';
import type { Conversation, Host, Message } from '@autohire/shared';
import { mockClient } from '@/mocks/client';
import { currentUser } from '@/mocks/data';
import { cn } from '@/lib/cn';
import { formatDayLabel, formatTime, timeAgo } from '@/lib/format';
import { Avatar, Button, Input, Spinner } from '@/components/ui';

function hostName(host?: Host): string {
  return host?.businessName ?? host?.fullName ?? 'Host';
}

/**
 * A5 — Messaging. Master–detail: searchable conversation list + chat thread
 * between the renter (current user) and the host. Opening a thread marks it
 * read; messages show timestamps, day separators, and read receipts. On mobile
 * only one pane shows at a time.
 */
export function MessagesPage() {
  const { id } = useParams();
  const [search, setSearch] = useState('');

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => mockClient.listConversations(),
  });
  const { data: hosts } = useQuery({ queryKey: ['hosts'], queryFn: () => mockClient.listHosts() });

  const hostsById = useMemo(() => new Map((hosts ?? []).map((h) => [h.id, h])), [hosts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations ?? [];
    return (conversations ?? []).filter(
      (c) =>
        hostName(hostsById.get(c.hostId)).toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q),
    );
  }, [conversations, hostsById, search]);

  const selected = conversations?.find((c) => c.id === id);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col p-3 sm:p-4">
      <div className="flex h-full overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
        {/* Conversation list */}
        <aside
          className={cn(
            'flex w-full flex-col border-ink-200 md:w-[360px] md:border-r',
            id && 'hidden md:flex',
          )}
        >
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <h1 className="text-xl font-bold text-ink-900">Messages</h1>
        </div>
        <div className="border-b border-ink-100 p-3">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <Input
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : filtered.length > 0 ? (
            <ul>
              {filtered.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  host={hostsById.get(c.hostId)}
                  active={c.id === id}
                />
              ))}
            </ul>
          ) : (
            <p className="p-6 text-sm text-ink-500">
              {search ? 'No conversations match.' : 'No conversations yet.'}
            </p>
          )}
        </div>
      </aside>

        {/* Thread */}
        <div className={cn('flex flex-1 flex-col', !id && 'hidden md:flex')}>
          {selected ? (
            <Thread conversation={selected} host={hostsById.get(selected.hostId)} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-400">
              <MessageSquare size={28} />
              <p className="text-sm">Select a conversation to start chatting.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  host,
  active,
}: {
  conversation: Conversation;
  host?: Host;
  active: boolean;
}) {
  const name = hostName(host);
  const unread = conversation.unread > 0;

  return (
    <li>
      <Link
        to={`/messages/${conversation.id}`}
        className={cn(
          'flex items-center gap-3 border-b border-ink-100 px-4 py-3 transition-colors hover:bg-ink-50',
          active && 'bg-brand-50',
        )}
      >
        <Avatar name={name} src={host?.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn('truncate text-ink-900', unread ? 'font-semibold' : 'font-medium')}>
              {name}
            </p>
            <span className="shrink-0 text-xs text-ink-400">
              {timeAgo(conversation.lastMessageAt)}
            </span>
          </div>
          <p
            className={cn(
              'truncate text-sm',
              unread ? 'font-medium text-ink-700' : 'text-ink-500',
            )}
          >
            {conversation.lastMessagePreview}
          </p>
        </div>
        {unread && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
            {conversation.unread}
          </span>
        )}
      </Link>
    </li>
  );
}

function Thread({ conversation, host }: { conversation: Conversation; host?: Host }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const listingQuery = useQuery({
    queryKey: ['listing', conversation.listingId],
    queryFn: () => mockClient.getListing(conversation.listingId),
  });
  const messagesQuery = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: () => mockClient.listMessages(conversation.id),
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => mockClient.sendMessage(conversation.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const readMutation = useMutation({
    mutationFn: () => mockClient.markConversationRead(conversation.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  });

  // Mark as read when the thread is opened or new unread arrives.
  const { mutate: markRead } = readMutation;
  useEffect(() => {
    if (conversation.unread > 0) markRead();
  }, [conversation.id, conversation.unread, markRead]);

  // Auto-scroll to the newest message.
  const messages = messagesQuery.data;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const name = hostName(host);

  function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    sendMutation.mutate(body);
    setDraft('');
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-ink-200 px-4 py-3">
        <Link
          to="/messages"
          className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 md:hidden"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </Link>
        <Avatar name={name} src={host?.avatarUrl} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{name}</p>
          {listingQuery.data && (
            <p className="truncate text-xs text-ink-500">About: {listingQuery.data.title}</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-1.5 overflow-y-auto bg-ink-50/40 p-4">
        {messagesQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size={22} />
          </div>
        ) : (
          messages?.map((m, i) => (
            <MessageRow key={m.id} message={m} previous={i > 0 ? messages[i - 1] : undefined} />
          ))
        )}
      </div>

      {/* Composer */}
      <form onSubmit={onSend} className="flex items-center gap-2 border-t border-ink-200 p-3">
        <Input
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Message"
        />
        <Button type="submit" disabled={!draft.trim() || sendMutation.isPending} aria-label="Send">
          <Send size={16} />
        </Button>
      </form>
    </>
  );
}

function MessageRow({ message, previous }: { message: Message; previous?: Message }) {
  const mine = message.senderId === currentUser.id;
  const showDay =
    !previous || new Date(previous.sentAt).toDateString() !== new Date(message.sentAt).toDateString();

  return (
    <>
      {showDay && (
        <div className="my-2 flex justify-center">
          <span className="rounded-full bg-ink-200/70 px-2.5 py-0.5 text-xs text-ink-600">
            {formatDayLabel(message.sentAt)}
          </span>
        </div>
      )}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
          mine
            ? 'self-end rounded-br-sm bg-brand-600 text-white'
            : 'self-start rounded-bl-sm bg-white text-ink-800 shadow-sm',
        )}
      >
        <p>{message.body}</p>
        <span
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            mine ? 'text-brand-100' : 'text-ink-400',
          )}
        >
          {formatTime(message.sentAt)}
          {mine &&
            (message.readAt ? <CheckCheck size={13} /> : <Check size={13} />)}
        </span>
      </div>
    </>
  );
}
