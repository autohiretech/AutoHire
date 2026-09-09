import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Car, Inbox, MessageSquare, Plus, Wallet } from 'lucide-react';
import { client } from '@/lib/client';
import { formatMoney } from '@/lib/currency';
import { HostAiField } from '@/components/research/HostAiField';
import { AiChat, type ChatMessage } from '@/components/AiChat';
import { Skeleton } from '@/components/ui';

/** Per-tab, and its own key — the host's conversation is not the renter's,
 * and a host who switches accounts should not inherit one. */
const CHAT_KEY = 'autohire-host-ai-chat';

function loadChat(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * `/ai` for a host. The renter build of this route is a map and a compound
 * "where/when" search bar — neither means anything to someone who lists
 * cars rather than rents them, so a host gets a different page entirely
 * rather than a renter page with pieces hidden.
 *
 * What replaces the map: the two numbers a host actually opens this app to
 * check (pending requests, what's ready to withdraw) as tappable cards into
 * the real screens that handle them, plus the same `ai-agent` field the
 * renter side uses — scoped to fleet questions by `HostAiField`, not this
 * page. Query keys match Dashboard/Earnings exactly (`ownerBookings`,
 * `ownerListings`, `payholdWallet`) so landing here after either doesn't
 * cost a second round trip.
 */
export function HostAiPage() {
  const { data: listings } = useQuery({
    queryKey: ['ownerListings'],
    queryFn: () => client.listOwnerListings(),
  });
  const { data: bookings } = useQuery({
    queryKey: ['ownerBookings'],
    queryFn: () => client.listOwnerBookings(),
  });
  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['payholdWallet'],
    queryFn: () => client.payholdBalance(),
  });

  const [messages, setMessages] = useState<ChatMessage[]>(loadChat);
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages));
    } catch {
      // Private mode / quota — the conversation still holds for this view.
    }
  }, [messages]);

  const pending = (bookings ?? []).filter((b) => b.state === 'requested').length;
  const withdrawable = wallet?.withdrawable.filter((w) => w.availableAmount > 0) ?? [];
  const fleetSize = listings?.length ?? 0;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto px-4 py-6">
      <div>
        <h1 className="text-h3 text-[var(--color-content)]">Your fleet, on request</h1>
        <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
          Ask about a booking, a listing, or your earnings — or jump straight in below.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/dashboard"
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-4 transition-colors hover:bg-[var(--color-surface-sunken)]"
        >
          <Inbox size={18} className="text-[var(--color-accent-on)]" />
          <p className="tabular text-h3 text-[var(--color-content)]">{pending}</p>
          <p className="text-body-sm text-[var(--color-content-muted)]">
            {pending === 1 ? 'request waiting' : 'requests waiting'}
          </p>
        </Link>

        <Link
          to="/earnings"
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-4 transition-colors hover:bg-[var(--color-surface-sunken)]"
        >
          <Wallet size={18} className="text-[var(--color-accent-on)]" />
          {walletLoading ? (
            <Skeleton className="h-8 w-20" />
          ) : withdrawable.length > 0 ? (
            <p className="tabular text-h3 text-[var(--color-content)]">
              {formatMoney(withdrawable[0].availableAmount, withdrawable[0].currency)}
            </p>
          ) : (
            <p className="text-h3 text-[var(--color-content-subtle)]">—</p>
          )}
          <p className="text-body-sm text-[var(--color-content-muted)]">
            {withdrawable.length > 0 ? 'ready to withdraw' : 'nothing cleared yet'}
          </p>
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <Link
          to="/cars/new"
          className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-3 text-body-sm font-medium text-[var(--color-content)] transition-colors hover:bg-[var(--color-surface-sunken)]"
        >
          <Plus size={16} className="text-[var(--color-content-subtle)]" />
          <span className="flex-1">List another car</span>
          <ArrowRight size={14} className="text-[var(--color-content-subtle)]" />
        </Link>
        <Link
          to="/dashboard"
          className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-3 text-body-sm font-medium text-[var(--color-content)] transition-colors hover:bg-[var(--color-surface-sunken)]"
        >
          <Car size={16} className="text-[var(--color-content-subtle)]" />
          <span className="flex-1">
            {fleetSize > 0 ? `Manage your ${fleetSize} ${fleetSize === 1 ? 'car' : 'cars'}` : 'Manage your fleet'}
          </span>
          <ArrowRight size={14} className="text-[var(--color-content-subtle)]" />
        </Link>
        <Link
          to="/messages"
          className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-3 text-body-sm font-medium text-[var(--color-content)] transition-colors hover:bg-[var(--color-surface-sunken)]"
        >
          <MessageSquare size={16} className="text-[var(--color-content-subtle)]" />
          <span className="flex-1">Message a renter</span>
          <ArrowRight size={14} className="text-[var(--color-content-subtle)]" />
        </Link>
      </div>

      {/* The conversation sits between the shortcuts and the field, which is
          the empty half of this page and the only place it reads as a chat:
          answers used to appear *under* the input, so a host's own question
          was above the box and the reply below it. `mt-auto` is on this
          wrapper rather than the field now, so with nothing asked yet the
          field still sits at the bottom exactly as before — `AiChat` renders
          nothing until there is something to show. */}
      <div className="mt-auto flex min-h-0 flex-col justify-end pt-2">
        <AiChat messages={messages} busy={aiBusy} className="max-h-[52vh]" />
      </div>

      <div className="pt-2">
        <HostAiField
          onMessage={(m) =>
            setMessages((prev) => [
              ...prev,
              { ...m, id: globalThis.crypto?.randomUUID?.() ?? `m${prev.length}-${Date.now()}` },
            ])
          }
          onBusyChange={setAiBusy}
        />
      </div>
    </div>
  );
}
