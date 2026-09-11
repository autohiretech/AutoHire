import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Car,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Search,
  ShieldAlert,
  ShieldQuestion,
  User,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AdminUser } from '@autohire/shared';
import { client } from '@/lib/client';
import type { AdminBroadcast, NotifyAudience } from '@/lib/supabaseClient';
import { formatDate, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Input,
  Label,
  Select,
  Skeleton,
  toast,
} from '@/components/ui';

const AUDIENCES: { key: NotifyAudience; label: string; hint: string; icon: LucideIcon }[] = [
  { key: 'everyone', label: 'Everyone', hint: 'Every host and renter', icon: Users },
  { key: 'hosts', label: 'Hosts', hint: 'Accounts that list cars or machinery', icon: Car },
  { key: 'renters', label: 'Renters', hint: 'Accounts that book but don’t list', icon: User },
  { key: 'unverified', label: 'Not verified yet', hint: 'Anyone who hasn’t finished verification', icon: ShieldQuestion },
  { key: 'unverified_hosts', label: 'Hosts not verified', hint: 'Hosts who still need to verify', icon: ShieldAlert },
  { key: 'people', label: 'Specific people', hint: 'Pick accounts by name or email', icon: UserPlus },
];

const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES.map((a) => [a.key, a.label])) as Record<
  NotifyAudience,
  string
>;

/**
 * Pages a notification's button can open. Only pages on AutoHire — the server
 * refuses anything else (migration 078), because a platform message that sends
 * people off-site is what phishing looks like.
 */
const LINKS = [
  { value: '', label: 'No button' },
  { value: '/verification', label: 'Verification' },
  { value: '/dashboard', label: 'Host dashboard' },
  { value: '/earnings', label: 'Earnings' },
  { value: '/payouts/setup', label: 'Payout setup' },
  { value: '/trips', label: 'Trips' },
  { value: '/search', label: 'Search' },
  { value: 'custom', label: 'Another page…' },
];

/** The same rule the server applies, so the form says no before the request does. */
const IN_APP_PATH = /^\/([A-Za-z0-9._~%-]+(\/[A-Za-z0-9._~%-]+)*\/?)?([?#]\S*)?$/;

const TITLE_MAX = 120;
const BODY_MAX = 2000;

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  /* very old browser — codes are shown as they are */
}
const countryName = (code: string) => regionNames?.of(code) ?? code;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Admin → Notifications: tell a group of people something at once — every
 * host, everyone still unverified, a handful of named accounts — and see how
 * many have read it. Each message lands in the recipients' notifications on
 * AutoHire; who is in an audience is decided on the server, so the count shown
 * before sending is the number of people who receive it.
 */
export function NotificationsSection() {
  return (
    <div className="space-y-8">
      <Composer />
      <SentList />
    </div>
  );
}

function Composer() {
  const queryClient = useQueryClient();
  const [audience, setAudience] = useState<NotifyAudience | null>(null);
  const [country, setCountry] = useState('');
  const [people, setPeople] = useState<AdminUser[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkChoice, setLinkChoice] = useState('');
  const [customLink, setCustomLink] = useState('');
  const [confirming, setConfirming] = useState(false);

  // The country filter is hidden while picking people by name, so the counts on
  // the audience cards must not quietly stay narrowed to a country you can't see.
  const sizeCountry = audience === 'people' ? '' : country;
  const sizes = useQuery({
    queryKey: ['notifyAudienceSizes', sizeCountry],
    queryFn: () => client.notifyAudienceSizes(sizeCountry || null),
  });
  const countries = useQuery({ queryKey: ['notifyCountries'], queryFn: () => client.notifyCountries() });

  const link = linkChoice === 'custom' ? customLink.trim() : linkChoice;
  const linkInvalid = link !== '' && !IN_APP_PATH.test(link);
  const reach = audience === 'people' ? people.length : audience ? sizes.data?.[audience] : undefined;

  const problem = !audience
    ? 'Choose who should get it.'
    : audience === 'people' && people.length === 0
      ? 'Add at least one person.'
      : reach === 0
        ? 'Nobody matches this audience.'
        : !body.trim()
          ? 'Write the message.'
          : linkInvalid
            ? 'The link must be a page on AutoHire, starting with /.'
            : null;

  const send = useMutation({
    mutationFn: () =>
      client.notifyPeople({
        audience: audience!,
        title,
        body,
        country: audience === 'people' ? null : country || null,
        people: audience === 'people' ? people.map((p) => p.id) : undefined,
        link: link || null,
      }),
    onSuccess: ({ recipientCount }) => {
      setConfirming(false);
      toast.success(`Sent to ${plural(recipientCount, 'person', 'people')}.`);
      setTitle('');
      setBody('');
      setLinkChoice('');
      setCustomLink('');
      setPeople([]);
      queryClient.invalidateQueries({ queryKey: ['adminBroadcasts'] });
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(e instanceof Error ? e.message : 'Could not send the notification.');
    },
  });

  const audienceDescription =
    audience === 'people'
      ? people.length <= 3
        ? people.map((p) => p.fullName).join(', ')
        : `${people
            .slice(0, 2)
            .map((p) => p.fullName)
            .join(', ')} and ${people.length - 2} others`
      : audience
        ? `${AUDIENCE_LABEL[audience]}${country ? ` in ${countryName(country)}` : ''}`
        : '';

  return (
    <Card>
      <CardHeader>
        <h2 className="text-body font-semibold text-[var(--color-content)]">New notification</h2>
        <p className="text-caption text-[var(--color-content-muted)]">
          It appears in their notifications on AutoHire, with a button if you add a page.
        </p>
      </CardHeader>
      <CardBody className="space-y-7">
        <fieldset>
          <legend className="mb-2 text-body-sm font-semibold text-[var(--color-content)]">
            1. Who should get it?
          </legend>
          <div role="radiogroup" aria-label="Audience" className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {AUDIENCES.map((a) => {
              const Icon = a.icon;
              const selected = audience === a.key;
              const n = a.key === 'people' ? (people.length || undefined) : sizes.data?.[a.key];
              return (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAudience(a.key)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-[var(--radius-control)] border p-2.5 text-left transition-colors sm:gap-3 sm:p-3',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]',
                    selected
                      ? 'border-[var(--color-accent-on)] bg-[color-mix(in_srgb,var(--color-accent-on)_8%,transparent)]'
                      : 'border-[var(--color-line)] hover:bg-[color-mix(in_srgb,var(--color-content)_4%,transparent)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
                      selected
                        ? 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
                        : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
                    )}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-body-sm font-semibold leading-tight text-[var(--color-content)]">
                        {a.label}
                      </span>
                      {a.key !== 'people' && sizes.isLoading ? (
                        <Skeleton className="h-4 w-8" />
                      ) : n !== undefined ? (
                        <span className="tabular shrink-0 text-caption font-semibold text-[var(--color-content-muted)]">
                          {n.toLocaleString()}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 hidden text-caption text-[var(--color-content-muted)] sm:block">{a.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {audience && audience !== 'people' && (
            <div className="mt-4 max-w-xs">
              <Label htmlFor="notify-country">Where</Label>
              <Select id="notify-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">All countries</option>
                {(countries.data ?? []).map((c) => (
                  <option key={c.country} value={c.country}>
                    {countryName(c.country)} ({c.people.toLocaleString()})
                  </option>
                ))}
              </Select>
            </div>
          )}

          {audience === 'people' && <PeoplePicker selected={people} onChange={setPeople} />}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-body-sm font-semibold text-[var(--color-content)]">
            2. What should it say?
          </legend>
          <div>
            <Label htmlFor="notify-title">Title</Label>
            <Input
              id="notify-title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Message from AutoHire"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="notify-body">Message</Label>
              <span className="tabular text-caption text-[var(--color-content-subtle)]">
                {body.length.toLocaleString()} / {BODY_MAX.toLocaleString()}
              </span>
            </div>
            <textarea
              id="notify-body"
              value={body}
              maxLength={BODY_MAX}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="What do they need to know?"
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] focus:outline-none"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="notify-link">Button opens</Label>
              <Select id="notify-link" value={linkChoice} onChange={(e) => setLinkChoice(e.target.value)}>
                {LINKS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            {linkChoice === 'custom' && (
              <div>
                <Label htmlFor="notify-custom-link">Page</Label>
                <Input
                  id="notify-custom-link"
                  value={customLink}
                  onChange={(e) => setCustomLink(e.target.value)}
                  placeholder="/cars/new"
                  aria-invalid={linkInvalid}
                />
                {linkInvalid && (
                  <p className="mt-1 text-caption text-[var(--color-danger-500)]">
                    Use a page on AutoHire, starting with /.
                  </p>
                )}
              </div>
            )}
          </div>
        </fieldset>

        <div>
          <p className="mb-2 text-body-sm font-semibold text-[var(--color-content)]">Preview</p>
          <div className="flex gap-3 rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-raised)] text-[var(--color-content-muted)]">
              <MessageSquare size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-[var(--color-content)]">
                {title.trim() || 'Message from AutoHire'}
              </p>
              <p className="whitespace-pre-wrap break-words text-body-sm text-[var(--color-content-muted)]">
                {body.trim() || 'Your message appears here.'}
              </p>
              {link && !linkInvalid && (
                <span className="mt-2 inline-block text-caption font-semibold text-[var(--color-accent-on)]">
                  Open →
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-[var(--color-content-muted)]" aria-live="polite">
            {problem ?? (
              <>
                Reaches{' '}
                <span className="font-semibold text-[var(--color-content)]">
                  {reach === undefined ? '…' : plural(reach, 'person', 'people')}
                </span>
              </>
            )}
          </p>
          <Button disabled={!!problem || reach === undefined || send.isPending} onClick={() => setConfirming(true)}>
            {send.isPending ? 'Sending…' : 'Send notification'}
          </Button>
        </div>
      </CardBody>

      <ConfirmDialog
        open={confirming}
        title={`Send to ${reach === undefined ? '' : plural(reach, 'person', 'people')}?`}
        body={
          <>
            <span className="font-semibold">{audienceDescription}</span> will get “
            {title.trim() || 'Message from AutoHire'}” in their notifications. A sent notification
            can’t be taken back.
          </>
        }
        confirmLabel="Send now"
        busy={send.isPending}
        onConfirm={() => send.mutate()}
        onClose={() => !send.isPending && setConfirming(false)}
      />
    </Card>
  );
}

function PeoplePicker({ selected, onChange }: { selected: AdminUser[]; onChange: (next: AdminUser[]) => void }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const results = useQuery({
    queryKey: ['adminUsers', 'notify-picker', search],
    queryFn: () => client.listUsers({ search, pageSize: 8 }),
    enabled: search.length >= 2,
  });
  const chosen = new Set(selected.map((p) => p.id));
  const rows = search.length >= 2 ? (results.data?.items ?? []) : [];

  return (
    <div className="mt-4 space-y-3">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen people">
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-sunken)] py-1 pl-1 pr-1.5 text-body-sm text-[var(--color-content)]"
            >
              <Avatar name={p.fullName} src={p.avatarUrl} size="sm" />
              <span className="max-w-[12rem] truncate">{p.fullName}</span>
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s.id !== p.id))}
                aria-label={`Remove ${p.fullName}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-content-muted)] hover:bg-[color-mix(in_srgb,var(--color-content)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-on)]"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
          className="pl-9"
        />
      </div>

      {search.length >= 2 && (
        <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)]">
          {results.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-3 text-body-sm text-[var(--color-content-muted)]">Nobody matches “{search}”.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {rows.map((u) => {
                const added = chosen.has(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                    <Avatar name={u.fullName} src={u.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-[var(--color-content)]">{u.fullName}</p>
                      <p className="truncate text-caption text-[var(--color-content-subtle)]">{u.email}</p>
                    </div>
                    <Badge tone="neutral" className="hidden sm:inline-flex">
                      {u.ownerType ? 'Host' : u.role === 'admin' ? 'Admin' : 'Renter'}
                    </Badge>
                    <Button
                      size="sm"
                      variant={added ? 'ghost' : 'outline'}
                      onClick={() =>
                        onChange(added ? selected.filter((s) => s.id !== u.id) : [...selected, u])
                      }
                    >
                      {added ? 'Added' : 'Add'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SentList() {
  const query = useQuery({
    queryKey: ['adminBroadcasts'],
    queryFn: () => client.listBroadcasts(),
    // Read counts climb as people open their notifications.
    refetchInterval: 30_000,
  });
  const sent = query.data ?? [];

  return (
    <section aria-labelledby="notify-sent">
      <h2 id="notify-sent" className="mb-3 text-body font-semibold text-[var(--color-content)]">
        Sent{sent.length > 0 && <span className="tabular ml-2 text-[var(--color-content-subtle)]">{sent.length}</span>}
      </h2>
      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <p className="text-body-sm text-[var(--color-danger-500)]">
          {query.error instanceof Error ? query.error.message : 'Could not load sent notifications.'}
        </p>
      ) : sent.length === 0 ? (
        <Card>
          <CardBody className="text-body-sm text-[var(--color-content-muted)]">
            Nothing sent yet. Notifications you send appear here, with how many people have read each one.
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-line)]">
            {sent.map((b) => (
              <SentRow key={b.id} b={b} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function audienceSummary(b: AdminBroadcast): string {
  if (b.audience === 'people') {
    const names = b.peopleNames;
    if (names.length === 0) return 'Specific people';
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }
  return `${AUDIENCE_LABEL[b.audience] ?? b.audience}${b.country ? ` · ${countryName(b.country)}` : ''}`;
}

function SentRow({ b }: { b: AdminBroadcast }) {
  const [open, setOpen] = useState(false);
  const pct = b.recipientCount > 0 ? Math.round((b.readCount * 100) / b.recipientCount) : 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[color-mix(in_srgb,var(--color-content)_3%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent-on)]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold text-[var(--color-content)]">{b.title}</p>
          <p className="truncate text-caption text-[var(--color-content-muted)]">
            {audienceSummary(b)} · {timeAgo(b.createdAt)}
          </p>
        </div>
        <div className="hidden w-32 shrink-0 sm:block">
          <p className="tabular text-right text-caption text-[var(--color-content-muted)]">
            {b.readCount.toLocaleString()} of {b.recipientCount.toLocaleString()} read
          </p>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
            role="progressbar"
            aria-label="Read"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="h-full rounded-full bg-[var(--color-accent-on)]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {open ? (
          <ChevronUp size={18} className="shrink-0 text-[var(--color-content-subtle)]" />
        ) : (
          <ChevronDown size={18} className="shrink-0 text-[var(--color-content-subtle)]" />
        )}
      </button>
      {open && (
        <div className="space-y-3 bg-[var(--color-surface-sunken)] px-4 py-3">
          <p className="whitespace-pre-wrap break-words text-body-sm text-[var(--color-content)]">{b.body}</p>
          <dl className="grid gap-2 text-caption sm:grid-cols-3">
            <div>
              <dt className="text-[var(--color-content-subtle)]">Read</dt>
              <dd className="tabular text-[var(--color-content)]">
                {b.readCount.toLocaleString()} of {plural(b.recipientCount, 'person', 'people')} ({pct}%)
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-subtle)]">Sent</dt>
              <dd className="text-[var(--color-content)]">
                {formatDate(b.createdAt)}
                {b.adminName ? ` by ${b.adminName}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-subtle)]">Button opens</dt>
              <dd className="break-all text-[var(--color-content)]">{b.link ?? 'No button'}</dd>
            </div>
          </dl>
          {b.audience === 'people' && b.peopleNames.length > 2 && (
            <p className="text-caption text-[var(--color-content-muted)]">To: {b.peopleNames.join(', ')}</p>
          )}
        </div>
      )}
    </li>
  );
}
