import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
import { Avatar, Button, Input, Spinner } from '@/components/ui';

type Party = UserProfile & Partial<Host>;

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function partyName(p?: Party): string {
  return p?.businessName ?? p?.fullName ?? 'User';
}

/**
 * A5 — Messaging. Master–detail: searchable conversation list + chat thread.
 * The thread is labelled by the OTHER participant (host or renter, whichever you
 * aren't) and supports replies, emoji reactions, deleting your own messages, and
 * image/file attachments.
 */
export function MessagesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data: me } = useCurrentUser();

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
    <div className="mx-auto flex h-full max-w-6xl flex-col p-3 sm:p-4">
      <div className="flex h-full overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
        {/* Conversation list */}
        <aside className={cn('flex w-full flex-col border-ink-200 md:w-[360px] md:border-r', id && 'hidden md:flex')}>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h1 className="text-xl font-bold text-ink-900">Messages</h1>
            {(conversations?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Delete ALL conversations? This removes them for both sides and cannot be undone.'))
                    deleteAll.mutate();
                }}
                disabled={deleteAll.isPending}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={14} /> Delete all
              </button>
            )}
          </div>
          <div className="border-b border-ink-100 p-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input placeholder="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                    party={partyOf(c)}
                    active={c.id === id}
                    unread={unreadMap?.[c.id] ?? 0}
                    onDelete={() => {
                      if (window.confirm('Delete this conversation for both sides?')) deleteOne.mutate(c.id);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="p-6 text-sm text-ink-500">{search ? 'No conversations match.' : 'No conversations yet.'}</p>
            )}
          </div>
        </aside>

        {/* Thread */}
        <div className={cn('flex flex-1 flex-col', !id && 'hidden md:flex')}>
          {selected ? (
            <Thread conversation={selected} party={partyOf(selected)} />
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
          'flex items-center gap-3 border-b border-ink-100 px-4 py-3 transition-colors hover:bg-ink-50',
          active && 'bg-brand-50',
        )}
      >
        <Avatar name={name} src={party?.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn('truncate text-ink-900', unread ? 'font-semibold' : 'font-medium')}>{name}</p>
            <span className="shrink-0 text-xs text-ink-400">{timeAgo(conversation.lastMessageAt)}</span>
          </div>
          <p className={cn('truncate pr-6 text-sm', unread ? 'font-medium text-ink-700' : 'text-ink-500')}>
            {conversation.lastMessagePreview || 'No messages yet'}
          </p>
        </div>
        {unread && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
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
        className="absolute bottom-2.5 right-3 rounded-lg p-1 text-ink-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
        aria-label="Delete conversation"
        title="Delete conversation"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

function Thread({ conversation, party }: { conversation: Conversation; party?: Party }) {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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
      <div className="flex items-center gap-3 border-b border-ink-200 px-4 py-3">
        <Link to="/messages" className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 md:hidden" aria-label="Back">
          <ArrowLeft size={18} />
        </Link>
        <Avatar name={name} src={party?.avatarUrl} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{name}</p>
          {listingQuery.data && <p className="truncate text-xs text-ink-500">About: {listingQuery.data.title}</p>}
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
        <div className="flex items-center gap-2 border-t border-ink-100 bg-ink-50 px-4 py-2 text-sm">
          <CornerUpLeft size={15} className="shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink-700">Replying to {replyTo.senderId === me?.id ? 'yourself' : name}</p>
            <p className="truncate text-xs text-ink-500">{replyTo.body || (replyTo.attachmentType === 'image' ? '📷 Photo' : '📎 Attachment')}</p>
          </div>
          <button type="button" onClick={() => setReplyTo(null)} className="rounded p-1 text-ink-400 hover:bg-ink-200" aria-label="Cancel reply">
            <X size={15} />
          </button>
        </div>
      )}
      {error && <p className="border-t border-ink-100 px-4 py-1.5 text-sm text-red-600">{error}</p>}

      {/* Composer */}
      <form onSubmit={onSend} className="flex items-center gap-2 border-t border-ink-200 p-3">
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" className="hidden" onChange={onPickFile} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 disabled:opacity-50"
          aria-label="Attach file"
          title="Attach a photo or file"
        >
          <Paperclip size={18} />
        </button>
        <Input placeholder={uploading ? 'Uploading…' : 'Type a message…'} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Message" />
        <Button type="submit" disabled={!draft.trim() || sendMutation.isPending} aria-label="Send">
          <Send size={16} />
        </Button>
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
  const mine = message.senderId === myId;
  const showDay = !previous || new Date(previous.sentAt).toDateString() !== new Date(message.sentAt).toDateString();
  const reactions = message.reactions ?? {};
  const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  return (
    <>
      {showDay && (
        <div className="my-2 flex justify-center">
          <span className="rounded-full bg-ink-200/70 px-2.5 py-0.5 text-xs text-ink-600">{formatDayLabel(message.sentAt)}</span>
        </div>
      )}
      <div className={cn('group flex max-w-[78%] flex-col', mine ? 'self-end items-end' : 'self-start items-start')}>
        <div className="flex items-end gap-1">
          {/* Hover actions (left of my bubbles, right of theirs) */}
          {mine && <BubbleActions mine onReply={onReply} onReact={onReact} onDelete={onDelete} showPicker={showPicker} setShowPicker={setShowPicker} />}

          <div
            className={cn(
              'rounded-2xl px-3.5 py-2 text-sm',
              mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-ink-800 shadow-sm',
            )}
          >
            {/* Quoted reply */}
            {repliedTo && (
              <div className={cn('mb-1 rounded-lg border-l-2 px-2 py-1 text-xs', mine ? 'border-white/60 bg-white/15 text-brand-50' : 'border-brand-400 bg-ink-50 text-ink-600')}>
                <p className="truncate">{repliedTo.body || (repliedTo.attachmentType === 'image' ? '📷 Photo' : '📎 Attachment')}</p>
              </div>
            )}

            {/* Attachment */}
            {message.attachmentUrl && message.attachmentType === 'image' && (
              <a href={message.attachmentUrl} target="_blank" rel="noreferrer noopener">
                <img src={message.attachmentUrl} alt={message.attachmentName ?? 'image'} className="mb-1 max-h-60 rounded-lg object-cover" />
              </a>
            )}
            {message.attachmentUrl && message.attachmentType !== 'image' && (
              <a
                href={message.attachmentUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={cn('mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5', mine ? 'bg-white/15' : 'bg-ink-100')}
              >
                <FileText size={16} />
                <span className="max-w-40 truncate text-xs">{message.attachmentName ?? 'File'}</span>
                <Download size={14} />
              </a>
            )}

            {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

            <span className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-brand-100' : 'text-ink-400')}>
              {formatTime(message.sentAt)}
              {mine && (message.readAt ? <CheckCheck size={13} /> : <Check size={13} />)}
            </span>
          </div>

          {!mine && <BubbleActions onReply={onReply} onReact={onReact} onDelete={onDelete} showPicker={showPicker} setShowPicker={setShowPicker} />}
        </div>

        {/* Reactions */}
        {reactionEntries.length > 0 && (
          <div className={cn('-mt-1 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
            {reactionEntries.map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                className={cn(
                  'flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs',
                  users.includes(myId ?? '') ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-600',
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
  onReply,
  onReact,
  onDelete,
  showPicker,
  setShowPicker,
}: {
  mine?: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  showPicker: boolean;
  setShowPicker: (v: boolean) => void;
}) {
  return (
    <div className="relative flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
        <div className="absolute bottom-7 z-10 flex gap-1 rounded-full border border-ink-200 bg-white p-1 shadow-md">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e);
                setShowPicker(false);
              }}
              className="rounded-full px-1 text-base hover:bg-ink-100"
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
    <button type="button" onClick={onClick} aria-label={label} className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
      {children}
    </button>
  );
}
