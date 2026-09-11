import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  Smile,
  Trash2,
  X,
} from 'lucide-react';
import type { Conversation, Host, Message, UserProfile } from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/cn';
import { formatDayLabel, formatTime, timeAgo } from '@/lib/format';
import { Avatar, Skeleton } from '@/components/ui';
import { useMatchMedia, useVisualViewport } from '@/lib/useVisualViewport';

type Party = UserProfile & Partial<Host>;

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** The composer's tallest, px — about five lines — before it scrolls. Matches `max-h-32`. */
const COMPOSER_MAX_PX = 128;

function partyName(p?: Party): string {
  return p?.businessName ?? p?.fullName ?? 'User';
}

/**
 * A5 — Messaging. Master–detail: searchable conversation list + chat thread.
 * The thread is labelled by the OTHER participant (host or renter, whichever you
 * aren't) and supports replies, emoji reactions, deleting your own messages, and
 * image/file attachments.
 *
 * Mobile shows one pane at a time — list, or thread with a back control — never
 * both squeezed into one 390px screen; the `id` route param is what toggles
 * which pane is visible below the `md` breakpoint.
 */
export function MessagesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data: me } = useCurrentUser();
  // On a phone an open thread fills the *visible* screen — the part above the
  // keyboard — rather than the layout, which extends behind it.
  const isPhone = useMatchMedia('(max-width: 767px)');
  const phoneThread = isPhone && !!id;
  const viewport = useVisualViewport(phoneThread);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => client.listConversations(),
  });

  const afterDelete = (deletedOpen: boolean) => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['unreadByConversation'] });
    queryClient.invalidateQueries({ queryKey: ['unreadMessages'] });
    if (deletedOpen) navigate('/messages');
  };

  const deleteOne = useMutation({
    mutationFn: (convId: string) => client.deleteConversation(convId),
    onSuccess: (_d, convId) => afterDelete(convId === id),
  });
  const deleteAll = useMutation({
    mutationFn: () => client.deleteAllConversations(),
    onSuccess: () => afterDelete(true),
  });
  const { data: unreadMap } = useQuery({
    queryKey: ['unreadByConversation'],
    queryFn: () => client.getUnreadByConversation(),
  });

  // The other party in each thread = whichever of renter/host I'm not.
  const otherId = (c: Conversation) => (me?.id === c.hostId ? c.renterId : c.hostId);
  const otherIds = useMemo(
    () => (conversations ?? []).map(otherId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, me?.id],
  );
  const { data: profiles } = useQuery({
    queryKey: ['chatProfiles', otherIds],
    queryFn: () => client.getProfilesByIds(otherIds),
    enabled: otherIds.length > 0,
  });
  const partyOf = (c: Conversation): Party | undefined => profiles?.[otherId(c)];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations ?? [];
    return (conversations ?? []).filter(
      (c) =>
        partyName(partyOf(c)).toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, profiles, search, me?.id]);

  const selected = conversations?.find((c) => c.id === id);

  return (
    // Edge to edge on a phone — a card with a 12px gutter and a border cost a
    // messaging screen width and height it has none of to spare.
    <div className="mx-auto flex h-full max-w-6xl flex-col md:p-4">
      <div className="flex h-full overflow-hidden bg-[var(--color-surface-raised)] md:rounded-[var(--radius-card)] md:border md:border-[var(--color-line)]">
        {/* Conversation list */}
        <aside
          className={cn(
            'flex w-full flex-col border-[var(--color-line)] md:w-[360px] md:border-r',
            id && 'hidden md:flex',
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
            <h1 className="text-h3 text-[var(--color-content)]">Messages</h1>
            {(conversations?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      'Delete ALL conversations? This removes them for both sides and cannot be undone.',
                    )
                  )
                    deleteAll.mutate();
                }}
                disabled={deleteAll.isPending}
                className="inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-caption font-medium text-[var(--color-danger-500)] hover:bg-[var(--color-danger-tint)] disabled:opacity-50"
              >
                <Trash2 size={14} /> Delete all
              </button>
            )}
          </div>
          <div className="border-b border-[var(--color-line)] p-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3.5 py-2">
              <Search size={15} className="shrink-0 text-[var(--color-content-subtle)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                // 16px on phones: iOS Safari zooms the page into any field
                // whose text is smaller, and doesn't zoom back out.
                className="w-full bg-transparent text-base text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] md:text-body-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <ConversationListSkeleton />
            ) : filtered.length > 0 ? (
              <ul>
                {filtered.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conversation={c}
                    party={partyOf(c)}
                    active={c.id === id}
                    unread={unreadMap?.[c.id] ?? 0}
                    onDelete={() => {
                      if (window.confirm('Delete this conversation for both sides?'))
                        deleteOne.mutate(c.id);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="p-6 text-body-sm text-[var(--color-content-muted)]">
                {search ? 'No conversations match.' : 'No conversations yet.'}
              </p>
            )}
          </div>
        </aside>

        {/* Thread */}
        {/* On a phone the open thread is a fixed layer sized to the visible
            viewport and moved to wherever iOS has scrolled it, so the header
            stays at the top and the composer sits directly on the keyboard.
            (Android, with `interactive-widget=resizes-content`, just reports
            a smaller height and no offset.) */}
        <div
          className={cn(
            'flex flex-1 flex-col',
            !id && 'hidden md:flex',
            id && 'max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:z-50 max-md:bg-[var(--color-surface-raised)]',
          )}
          style={
            phoneThread
              ? { height: viewport.height, transform: `translateY(${viewport.offsetTop}px)` }
              : undefined
          }
        >
          {selected ? (
            <Thread
              conversation={selected}
              party={partyOf(selected)}
              viewportHeight={phoneThread ? viewport.height : undefined}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[var(--color-content-subtle)]">
              <MessageSquare size={28} />
              <p className="text-body-sm">Select a conversation to start chatting.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rows shaped like `ConversationRow` — avatar circle, a name-width line and
 * a shorter preview line beneath it — so the list doesn't resize once
 * conversations land. */
function ConversationListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-[var(--radius-pill)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Alternating bubble-shaped blocks — narrower ones right-aligned for "mine",
 * left-aligned for "theirs" — standing in for a loading thread above the
 * composer, which stays rendered throughout. */
function ThreadSkeleton() {
  const bubbles: { mine: boolean; w: string }[] = [
    { mine: false, w: 'w-44' },
    { mine: false, w: 'w-56' },
    { mine: true, w: 'w-32' },
    { mine: false, w: 'w-48' },
    { mine: true, w: 'w-40' },
    { mine: true, w: 'w-28' },
  ];
  return (
    <>
      {bubbles.map((b, i) => (
        <Skeleton
          key={i}
          className={cn('h-9 max-w-[78%]', b.w, b.mine ? 'self-end' : 'self-start')}
        />
      ))}
    </>
  );
}

function ConversationRow({
  conversation,
  party,
  active,
  unread: unreadCount,
  onDelete,
}: {
  conversation: Conversation;
  party?: Party;
  active: boolean;
  unread: number;
  onDelete: () => void;
}) {
  const name = partyName(party);
  const unread = unreadCount > 0;

  return (
    <li className="group relative">
      <Link
        to={`/messages/${conversation.id}`}
        className={cn(
          'flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-sunken)]',
          active && 'bg-[var(--color-surface-sunken)]',
        )}
      >
        <Avatar name={name} src={party?.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cn(
                'truncate text-[var(--color-content)]',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </p>
            <span className="tabular shrink-0 text-caption text-[var(--color-content-subtle)]">
              {timeAgo(conversation.lastMessageAt)}
            </span>
          </div>
          <p
            className={cn(
              'truncate pr-6 text-body-sm',
              unread ? 'font-medium text-[var(--color-content)]' : 'text-[var(--color-content-muted)]',
            )}
          >
            {conversation.lastMessagePreview || 'No messages yet'}
          </p>
        </div>
        {unread && (
          <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-danger-500)] px-1.5 text-caption font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        // Hover reveals it on desktop; a touch screen has no hover, so there
        // it is simply always there.
        className="absolute bottom-2.5 right-3 rounded-[var(--radius-control)] p-1 text-[var(--color-content-subtle)] opacity-0 transition-opacity hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-500)] group-hover:opacity-100 [@media(hover:none)]:p-2 [@media(hover:none)]:opacity-100"
        aria-label="Delete conversation"
        title="Delete conversation"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

function Thread({
  conversation,
  party,
  viewportHeight,
}: {
  conversation: Conversation;
  party?: Party;
  /** The visible height on a phone; changes when the keyboard opens or closes. */
  viewportHeight?: number;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const listingQuery = useQuery({
    queryKey: ['listing', conversation.listingId],
    queryFn: () => client.getListing(conversation.listingId),
  });
  const messagesQuery = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: () => client.listMessages(conversation.id),
  });

  const invalidateThread = () => {
    queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const sendMutation = useMutation({
    mutationFn: (payload: { body: string; opts?: Parameters<typeof client.sendMessage>[2] }) =>
      client.sendMessage(conversation.id, payload.body, payload.opts),
    onSuccess: invalidateThread,
  });
  const reactMutation = useMutation({
    mutationFn: (p: { id: string; emoji: string }) => client.toggleReaction(p.id, p.emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.deleteMessage(id),
    onSuccess: invalidateThread,
  });
  const readMutation = useMutation({
    mutationFn: () => client.markConversationRead(conversation.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['unreadMessages'] });
      queryClient.invalidateQueries({ queryKey: ['unreadByConversation'] });
    },
  });

  const messages = messagesQuery.data;
  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  const { mutate: markRead } = readMutation;
  useEffect(() => {
    const hasUnread = (messages ?? []).some((m) => m.senderId !== me?.id && !m.readAt);
    if (hasUnread) markRead();
  }, [messages, me?.id, markRead]);
  // New messages, and the keyboard opening (the thread just lost ~40% of its
  // height), both keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, viewportHeight]);

  // The composer grows with what's typed, up to ~5 lines, then scrolls.
  // `scrollHeight` leaves out the border but `height` (border-box) includes
  // it, so the border is added back — without that a single line measured 2px
  // too short and showed a scrollbar in an empty field.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, COMPOSER_MAX_PX)}px`;
    el.style.overflowY = wanted > COMPOSER_MAX_PX ? 'auto' : 'hidden';
  }, [draft]);

  function send(body: string, opts?: Parameters<typeof client.sendMessage>[2]) {
    sendMutation.mutate({ body, opts: { ...opts, replyTo: replyTo?.id } });
    setReplyTo(null);
  }

  function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    send(body);
    setDraft('');
    // Keep the keyboard up for the next message, as a messaging app does.
    inputRef.current?.focus();
  }

  // Enter sends, Shift+Enter is a new line. `isComposing` leaves Enter alone
  // while an IME is still composing a word.
  function onComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const up = await client.uploadChatFile(file);
      send('', { attachmentUrl: up.url, attachmentType: up.type, attachmentName: up.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the file.');
    } finally {
      setUploading(false);
    }
  }

  const name = partyName(party);

  return (
    <>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] px-4 py-2 md:py-3">
        <Link
          to="/messages"
          className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)] md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeft size={20} />
        </Link>
        <Avatar name={name} src={party?.avatarUrl} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--color-content)]">{name}</p>
          {listingQuery.data && (
            <p className="truncate text-caption text-[var(--color-content-muted)]">
              About: {listingQuery.data.title}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain bg-[var(--color-surface)] p-4"
        {...(messagesQuery.isLoading ? { 'aria-busy': 'true', 'aria-label': 'Loading' } : {})}
      >
        {messagesQuery.isLoading ? (
          <ThreadSkeleton />
        ) : (
          messages?.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              previous={i > 0 ? messages[i - 1] : undefined}
              repliedTo={m.replyTo ? byId.get(m.replyTo) : undefined}
              myId={me?.id}
              onReply={() => setReplyTo(m)}
              onReact={(emoji) => reactMutation.mutate({ id: m.id, emoji })}
              onDelete={() => deleteMutation.mutate(m.id)}
            />
          ))
        )}
      </div>

      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-2 text-body-sm">
          <CornerUpLeft size={15} className="shrink-0 text-[var(--color-content-muted)]" />
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium text-[var(--color-content)]">
              Replying to {replyTo.senderId === me?.id ? 'yourself' : name}
            </p>
            <p className="truncate text-caption text-[var(--color-content-muted)]">
              {replyTo.body || (replyTo.attachmentType === 'image' ? '📷 Photo' : '📎 Attachment')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="rounded-[var(--radius-control)] p-1 text-[var(--color-content-subtle)] hover:bg-[var(--color-line)]"
            aria-label="Cancel reply"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <p className="border-t border-[var(--color-line)] px-4 py-1.5 text-body-sm text-[var(--color-danger-500)]">
          {error}
        </p>
      )}

      {/* Composer — a pill input with one send button, the screen's one accent. */}
      {/* `onPointerDown` preventDefault on the two buttons: tapping a button
          normally moves focus off the text field, which closes a phone's
          keyboard mid-conversation. The click still fires. */}
      <form
        onSubmit={onSend}
        className="flex shrink-0 items-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface-raised)] px-3 py-2 md:p-3"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={onPickFile}
        />
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
          aria-label="Attach file"
          title="Attach a photo or file"
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKeyDown}
          enterKeyHint="send"
          placeholder={uploading ? 'Uploading…' : 'Type a message…'}
          aria-label="Message"
          // 16px on phones, or iOS zooms the page into the field on focus.
          className="block max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-[1.375rem] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-4 py-2.5 text-base leading-6 text-[var(--color-content)] outline-none placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] md:text-body-sm md:leading-6"
        />
        <button
          type="submit"
          onPointerDown={(e) => e.preventDefault()}
          disabled={!draft.trim() || sendMutation.isPending}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={18} />
        </button>
      </form>
    </>
  );
}

function MessageBubble({
  message,
  previous,
  repliedTo,
  myId,
  onReply,
  onReact,
  onDelete,
}: {
  message: Message;
  previous?: Message;
  repliedTo?: Message;
  myId?: string;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const mine = message.senderId === myId;
  const showDay = !previous || new Date(previous.sentAt).toDateString() !== new Date(message.sentAt).toDateString();
  const reactions = message.reactions ?? {};
  const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  return (
    <>
      {showDay && (
        <div className="my-2 flex justify-center">
          <span className="rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-caption text-[var(--color-content-muted)]">
            {formatDayLabel(message.sentAt)}
          </span>
        </div>
      )}
      <div className={cn('group flex max-w-[78%] flex-col', mine ? 'self-end items-end' : 'self-start items-start')}>
        <div className="flex items-end gap-1">
          {/* Hover actions (left of my bubbles, right of theirs) */}
          {mine && (
            <BubbleActions
              mine
              open={actionsOpen || showPicker}
              onReply={onReply}
              onReact={onReact}
              onDelete={onDelete}
              showPicker={showPicker}
              setShowPicker={setShowPicker}
            />
          )}

          {/* Mine = surface-inverse (high-contrast, no hue); theirs = surface-sunken.
              Never green — the accent is spent once, on the composer's send button. */}
          <div
            onClick={() => {
              // A touch screen has no hover, so a tap on the bubble is what
              // reveals react / reply / delete.
              if (window.matchMedia('(hover: none)').matches) setActionsOpen((v) => !v);
            }}
            className={cn(
              'rounded-[var(--radius-card)] px-3.5 py-2 text-body-sm',
              mine
                ? 'rounded-br-sm bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
                : 'rounded-bl-sm bg-[var(--color-surface-sunken)] text-[var(--color-content)]',
            )}
          >
            {/* Quoted reply */}
            {repliedTo && (
              <div
                className={cn(
                  'mb-1 rounded-[var(--radius-control)] border-l-2 px-2 py-1 text-caption',
                  mine
                    ? 'border-[var(--color-content-inverse)]/40 bg-[var(--color-content-inverse)]/15'
                    : 'border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)]',
                )}
              >
                <p className="truncate">
                  {repliedTo.body || (repliedTo.attachmentType === 'image' ? '📷 Photo' : '📎 Attachment')}
                </p>
              </div>
            )}

            {/* Attachment */}
            {message.attachmentUrl && message.attachmentType === 'image' && (
              <a href={message.attachmentUrl} target="_blank" rel="noreferrer noopener">
                <img
                  src={message.attachmentUrl}
                  alt={message.attachmentName ?? 'image'}
                  className="mb-1 max-h-60 rounded-[var(--radius-control)] object-cover"
                />
              </a>
            )}
            {message.attachmentUrl && message.attachmentType !== 'image' && (
              <a
                href={message.attachmentUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  'mb-1 flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5',
                  mine ? 'bg-[var(--color-content-inverse)]/15' : 'bg-[var(--color-surface-raised)]',
                )}
              >
                <FileText size={16} />
                <span className="max-w-40 truncate text-caption">{message.attachmentName ?? 'File'}</span>
                <Download size={14} />
              </a>
            )}

            {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

            <span
              className={cn(
                'tabular mt-1 flex items-center justify-end gap-1 text-[10px]',
                mine ? 'text-[var(--color-content-inverse)]/70' : 'text-[var(--color-content-subtle)]',
              )}
            >
              {formatTime(message.sentAt)}
              {mine && (message.readAt ? <CheckCheck size={13} /> : <Check size={13} />)}
            </span>
          </div>

          {!mine && (
            <BubbleActions
              open={actionsOpen || showPicker}
              onReply={onReply}
              onReact={onReact}
              onDelete={onDelete}
              showPicker={showPicker}
              setShowPicker={setShowPicker}
            />
          )}
        </div>

        {/* Reactions — selection is fill+weight (invert to surface-inverse), not hue. */}
        {reactionEntries.length > 0 && (
          <div className={cn('-mt-1 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
            {reactionEntries.map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                className={cn(
                  'tabular flex items-center gap-0.5 rounded-[var(--radius-pill)] border px-1.5 py-0.5 text-caption',
                  users.includes(myId ?? '')
                    ? 'border-[var(--color-surface-inverse)] bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)]',
                )}
              >
                {emoji} {users.length}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function BubbleActions({
  mine,
  open,
  onReply,
  onReact,
  onDelete,
  showPicker,
  setShowPicker,
}: {
  mine?: boolean;
  /** Shown without hover — after a tap on a touch screen, or while the picker is up. */
  open?: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  showPicker: boolean;
  setShowPicker: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-0.5 transition-opacity',
        open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
      )}
    >
      <IconBtn label="React" onClick={() => setShowPicker(!showPicker)}>
        <Smile size={15} />
      </IconBtn>
      <IconBtn label="Reply" onClick={onReply}>
        <CornerUpLeft size={15} />
      </IconBtn>
      {mine && (
        <IconBtn label="Delete" onClick={onDelete}>
          <Trash2 size={15} />
        </IconBtn>
      )}
      {showPicker && (
        <div className="absolute bottom-7 z-10 flex gap-1 rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-1 shadow-[var(--shadow-float)]">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e);
                setShowPicker(false);
              }}
              className="rounded-[var(--radius-pill)] px-1 text-body hover:bg-[var(--color-surface-sunken)]"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-[var(--radius-pill)] p-1 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)] [@media(hover:none)]:p-2"
    >
      {children}
    </button>
  );
}
