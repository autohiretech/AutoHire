import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  History,
  Search,
  Send,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  OwnerType,
  UserRole,
  VerificationDocType,
  VerificationEvent,
  VerificationEventKind,
  VerificationReviewItem,
  VerificationStatus,
} from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import {
  DOC_TYPE_LABEL,
  REJECTION_REASONS,
  VERIFICATION_META,
  accountKindLabel,
  relayVerificationToPayhold,
  requiredDocTypes,
} from '@/lib/admin';
import { Avatar, Badge, Button, Card, Chip, ConfirmDialog, Input, Skeleton, Spinner, toast } from '@/components/ui';

const PAGE_SIZE = 20;

/** Who is being reviewed — a queue entry or a row from Admin → Users. */
export interface KycPerson {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string;
  role: UserRole;
  ownerType?: OwnerType;
  verification: VerificationStatus;
  verificationOverride?: boolean;
}

/** Everything a KYC decision can change on screen. */
export function invalidateKyc(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['verificationProfiles', 'kycMetrics', 'kycEvents', 'adminOverview', 'profileDocs', 'adminUsers']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/** Single-letter shortcuts must never fire while the admin is typing a reason. */
function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
  );
}

/**
 * Admin → Verification.
 *
 * The queue on the left, one person on the right — the admin never loses their
 * place in a list of collapsed cards. A decision that clears someone's last
 * waiting document takes them out of "Needs review", and the next person in
 * the list is selected in their place, so working the queue is: look, decide,
 * look, decide. J/K move between people; A approves and R rejects the open
 * document.
 */
export function KycReviewSection() {
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);
  // Phones show one pane at a time; this is "the admin opened someone".
  const [detailOnPhone, setDetailOnPhone] = useState(false);

  const query = useQuery({
    queryKey: ['verificationProfiles', scope, term, page],
    queryFn: () => client.listVerificationProfiles({ scope, search: term, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const people = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  // The selected person, or — when a decision just took them out of the list —
  // whoever now sits where they were.
  const found = people.findIndex((p) => p.id === selectedId);
  const index = found >= 0 ? found : Math.min(anchor, people.length - 1);
  const selected = index >= 0 ? people[index] : undefined;

  useEffect(() => {
    if (found >= 0) setAnchor(found);
  }, [found]);

  function select(i: number, openOnPhone: boolean) {
    const p = people[i];
    if (!p) return;
    setSelectedId(p.id);
    setAnchor(i);
    if (openOnPhone) setDetailOnPhone(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e)) return;
      if (e.key === 'j') select(Math.min(index + 1, people.length - 1), false);
      else if (e.key === 'k') select(Math.max(index - 1, 0), false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function changeScope(next: 'pending' | 'all') {
    setScope(next);
    setPage(0);
    setSelectedId(null);
    setAnchor(0);
  }

  return (
    <div className="space-y-4">
      <AutoApproveSwitch />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
        {/* Queue */}
        <Card className={cn('overflow-hidden lg:sticky lg:top-4', detailOnPhone && 'hidden lg:block')}>
          <div className="space-y-3 border-b border-[var(--color-line)] p-3">
            <div className="flex gap-1.5">
              <Chip selected={scope === 'pending'} onClick={() => changeScope('pending')}>
                Needs review
              </Chip>
              <Chip selected={scope === 'all'} onClick={() => changeScope('all')}>
                Everyone
              </Chip>
            </div>
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                setTerm(search);
                setPage(0);
                setSelectedId(null);
                setAnchor(0);
              }}
            >
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-content-subtle)]"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email…"
                className="pl-9"
              />
            </form>
            <p className="tabular px-0.5 text-caption text-[var(--color-content-subtle)]">
              {query.isLoading
                ? 'Loading…'
                : scope === 'pending'
                  ? `${total} ${total === 1 ? 'person' : 'people'} waiting`
                  : `${total} ${total === 1 ? 'person has' : 'people have'} uploaded documents`}
            </p>
          </div>

          <div className="p-1.5 lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto">
            {query.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : people.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <CheckCircle2 size={22} className="mx-auto text-[var(--color-accent-on)]" />
                <p className="mt-2 text-body-sm font-medium text-[var(--color-content)]">
                  {scope === 'pending' ? 'Nobody is waiting for a decision.' : 'No one matches.'}
                </p>
                {scope === 'pending' && (
                  <button
                    type="button"
                    onClick={() => changeScope('all')}
                    className="mt-1 text-caption text-[var(--color-accent-on)] hover:underline"
                  >
                    Look at everyone instead
                  </button>
                )}
              </div>
            ) : (
              people.map((p, i) => {
                const meta = VERIFICATION_META[p.verification];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => select(i, true)}
                    aria-current={i === index}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2.5 text-left transition-colors',
                      i === index
                        ? 'bg-[var(--color-surface-sunken)] shadow-[inset_3px_0_0_var(--color-accent-on)]'
                        : 'hover:bg-[var(--color-surface-sunken)]',
                    )}
                  >
                    <Avatar name={p.fullName} src={p.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-[var(--color-content)]">
                        {p.fullName}
                      </span>
                      <span className="block truncate text-caption text-[var(--color-content-subtle)]">
                        {accountKindLabel(p.role, p.ownerType)} · {p.email}
                      </span>
                    </span>
                    {p.pendingCount > 0 ? (
                      <Badge tone="warn" className="tabular shrink-0">
                        {p.pendingCount}
                      </Badge>
                    ) : (
                      <Badge tone={meta.tone} className="shrink-0">
                        {meta.label}
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-[var(--color-line)] px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 0 || query.isFetching}
                onClick={() => {
                  setPage((p) => p - 1);
                  setAnchor(0);
                }}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="tabular text-caption text-[var(--color-content-subtle)]">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= total || query.isFetching}
                onClick={() => {
                  setPage((p) => p + 1);
                  setAnchor(0);
                }}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </Card>

        {/* Person */}
        <div className={cn('min-w-0', !detailOnPhone && 'hidden lg:block')}>
          <button
            type="button"
            onClick={() => setDetailOnPhone(false)}
            className="mb-3 inline-flex items-center gap-1.5 text-body-sm font-medium text-[var(--color-content-muted)] lg:hidden"
          >
            <ArrowLeft size={16} /> Back to the list
          </button>
          {selected ? (
            <PersonVerification
              key={selected.id}
              person={selected}
              shortcuts
              position={{ index, count: people.length }}
              onPrev={index > 0 ? () => select(index - 1, true) : undefined}
              onNext={index < people.length - 1 ? () => select(index + 1, true) : undefined}
            />
          ) : (
            !query.isLoading && (
              <Card className="hidden px-6 py-16 text-center text-body-sm text-[var(--color-content-muted)] lg:block">
                Pick someone from the list to review their documents.
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One person's verification, start to finish: what the database needs from
 * them, each document with its file right there to look at, a decision per
 * document, a decision for the whole account, and what has happened so far.
 *
 * Used by the review queue and by Admin → Users, so a decision works the same
 * way wherever an admin makes it.
 */
export function PersonVerification({
  person,
  shortcuts = false,
  position,
  onPrev,
  onNext,
}: {
  person: KycPerson;
  shortcuts?: boolean;
  position?: { index: number; count: number };
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const qc = useQueryClient();
  const docsQuery = useQuery({
    queryKey: ['profileDocs', person.id],
    queryFn: () => client.listVerificationsForProfile(person.id),
  });
  const docs = docsQuery.data ?? [];
  const byType = new Map(docs.map((d) => [d.type, d]));
  const required = requiredDocTypes(person.role, person.ownerType);
  const extras = docs.filter((d) => !required.includes(d.type)).map((d) => d.type);
  const approved = required.filter((t) => byType.get(t)?.status === 'verified').length;

  const [active, setActive] = useState<VerificationDocType | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<VerificationDocType>>(new Set());
  const firstWaiting = [...required, ...extras].find((t) => byType.get(t)?.status === 'pending');
  const activeType = active ?? firstWaiting ?? required.find((t) => byType.get(t)?.status !== 'verified') ?? required[0];

  const decide = useMutation({
    mutationFn: (v: { doc: VerificationReviewItem; status: 'verified' | 'rejected'; note?: string }) =>
      client.reviewVerificationDocument(v.doc.id, v.status, v.note),
    onSuccess: (_row, v) => {
      invalidateKyc(qc);
      setRejecting(null);
      // Hand focus back to "the next document still waiting".
      setActive(null);
      toast.success(
        v.status === 'verified'
          ? `${DOC_TYPE_LABEL[v.doc.type]} approved.`
          : `${DOC_TYPE_LABEL[v.doc.type]} rejected. They'll see your reason.`,
      );
      // Approving one document only verifies the person once every required
      // one is approved; until then PayHold is told "not verified", quietly.
      void relayVerificationToPayhold(person.id, { quietUnlessVerified: v.status === 'verified' });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that decision."),
  });

  const ask = useMutation({
    mutationFn: (type: VerificationDocType) => {
      const label = DOC_TYPE_LABEL[type].toLowerCase();
      return client.sendUserMessage(
        person.id,
        `Please upload your ${label}`,
        `To finish verifying your AutoHire account we still need your ${label}. You can upload it from the verification section of your account.`,
      );
    },
    onSuccess: (_r, type) => {
      setAsked((s) => new Set(s).add(type));
      toast.success(`Asked ${person.fullName} for their ${DOC_TYPE_LABEL[type].toLowerCase()}.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send the message."),
  });

  useEffect(() => {
    if (!shortcuts) return;
    function onKey(e: KeyboardEvent) {
      if (isTyping(e)) return;
      const doc = byType.get(activeType);
      if (!doc || decide.isPending) return;
      if (e.key === 'a' && doc.status !== 'verified') {
        e.preventDefault();
        decide.mutate({ doc, status: 'verified' });
      } else if (e.key === 'r' && doc.status !== 'rejected') {
        e.preventDefault();
        setRejecting(doc.id);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const meta = VERIFICATION_META[person.verification];

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3 sm:gap-4">
          <Avatar name={person.fullName} src={person.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-h4 text-[var(--color-content)]">{person.fullName}</h2>
            <p className="truncate text-body-sm text-[var(--color-content-muted)]">{person.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{accountKindLabel(person.role, person.ownerType)}</Badge>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {person.verificationOverride && <Badge tone="info">Set by an admin</Badge>}
            </div>
          </div>
          {position && (onPrev || onNext) && (
            <div className="flex shrink-0 items-center gap-1">
              <span className="tabular mr-1 hidden text-caption text-[var(--color-content-subtle)] sm:inline">
                {position.index + 1} of {position.count}
              </span>
              <Button variant="outline" size="sm" disabled={!onPrev} onClick={onPrev} aria-label="Previous person">
                <ChevronLeft size={16} />
              </Button>
              <Button variant="outline" size="sm" disabled={!onNext} onClick={onNext} aria-label="Next person">
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-caption">
            <span className="text-[var(--color-content-muted)]">
              {approved} of {required.length} required documents approved
            </span>
            {person.verification === 'verified' && !person.verificationOverride && (
              <span className="font-medium text-[var(--color-accent-on)]">Complete</span>
            )}
          </div>
          <div className="mt-1.5 flex h-1.5 gap-1">
            {required.map((t) => {
              const s = byType.get(t)?.status;
              return (
                <span
                  key={t}
                  className={cn(
                    'flex-1 rounded-[var(--radius-pill)]',
                    s === 'verified'
                      ? 'bg-[var(--color-accent-on)]'
                      : s === 'pending'
                        ? 'bg-[var(--color-warn-500)]'
                        : s === 'rejected'
                          ? 'bg-[var(--color-danger-500)]'
                          : 'bg-[var(--color-surface-sunken)]',
                  )}
                />
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <SectionHeading>Required documents</SectionHeading>
        {docsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size={18} />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {required.map((type) => (
              <DocumentItem
                key={type}
                type={type}
                doc={byType.get(type)}
                open={type === activeType}
                onOpen={() => setActive(type === activeType ? null : type)}
                rejecting={!!byType.get(type) && rejecting === byType.get(type)!.id}
                onStartReject={() => setRejecting(byType.get(type)!.id)}
                onCancelReject={() => setRejecting(null)}
                onDecide={(status, note) => decide.mutate({ doc: byType.get(type)!, status, note })}
                busy={decide.isPending}
                onAsk={() => ask.mutate(type)}
                asking={ask.isPending && ask.variables === type}
                asked={asked.has(type)}
              />
            ))}
          </ul>
        )}
        {extras.length > 0 && (
          <>
            <SectionHeading className="border-t">Other documents</SectionHeading>
            <ul className="divide-y divide-[var(--color-line)]">
              {extras.map((type) => (
                <DocumentItem
                  key={type}
                  type={type}
                  doc={byType.get(type)}
                  open={type === activeType}
                  onOpen={() => setActive(type === activeType ? null : type)}
                  rejecting={rejecting === byType.get(type)!.id}
                  onStartReject={() => setRejecting(byType.get(type)!.id)}
                  onCancelReject={() => setRejecting(null)}
                  onDecide={(status, note) => decide.mutate({ doc: byType.get(type)!, status, note })}
                  busy={decide.isPending}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      <AccountDecision person={person} />
      <PersonHistory profileId={person.id} />

      {shortcuts && (
        <p className="hidden items-center gap-3 px-1 text-caption text-[var(--color-content-subtle)] lg:flex">
          <Kbd>J</Kbd>/<Kbd>K</Kbd> next or previous person
          <span aria-hidden>·</span>
          <Kbd>A</Kbd> approve
          <span aria-hidden>·</span>
          <Kbd>R</Kbd> reject the open document
        </p>
      )}
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--color-content-muted)]">
      {children}
    </kbd>
  );
}

function SectionHeading({ children, className }: { children: string; className?: string }) {
  return (
    <h3
      className={cn(
        'border-b border-[var(--color-line)] px-4 py-2.5 text-caption font-semibold uppercase tracking-wide text-[var(--color-content-subtle)] sm:px-5',
        className,
      )}
    >
      {children}
    </h3>
  );
}

const DOC_STATUS_ICON: Record<VerificationStatus | 'missing', { icon: LucideIcon; className: string }> = {
  verified: { icon: CheckCircle2, className: 'text-[var(--color-accent-on)]' },
  pending: { icon: Clock, className: 'text-[var(--color-warn-500)]' },
  rejected: { icon: XCircle, className: 'text-[var(--color-danger-500)]' },
  unverified: { icon: Circle, className: 'text-[var(--color-content-subtle)]' },
  missing: { icon: Circle, className: 'text-[var(--color-content-subtle)]' },
};

function DocumentItem({
  type,
  doc,
  open,
  onOpen,
  rejecting,
  onStartReject,
  onCancelReject,
  onDecide,
  busy,
  onAsk,
  asking,
  asked,
}: {
  type: VerificationDocType;
  doc?: VerificationReviewItem;
  open: boolean;
  onOpen: () => void;
  rejecting: boolean;
  onStartReject: () => void;
  onCancelReject: () => void;
  onDecide: (status: 'verified' | 'rejected', note?: string) => void;
  busy: boolean;
  onAsk?: () => void;
  asking?: boolean;
  asked?: boolean;
}) {
  const state = doc ? doc.status : 'missing';
  const { icon: Icon, className: iconClass } = DOC_STATUS_ICON[state];
  const meta = doc ? VERIFICATION_META[doc.status] : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors sm:px-5',
          open ? 'bg-[var(--color-surface-sunken)]' : 'hover:bg-[var(--color-surface-sunken)]',
        )}
      >
        <Icon size={18} className={cn('shrink-0', iconClass)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-[var(--color-content)]">
            {DOC_TYPE_LABEL[type]}
          </span>
          <span className="block truncate text-caption text-[var(--color-content-subtle)]">
            {doc
              ? [doc.fileName, doc.uploadedAt && `uploaded ${timeAgo(doc.uploadedAt)}`, doc.reviewedAt && `reviewed ${timeAgo(doc.reviewedAt)}`]
                  .filter(Boolean)
                  .join(' · ') || 'Uploaded'
              : asked
                ? 'Not uploaded yet · asked for it'
                : 'Not uploaded yet'}
          </span>
        </span>
        {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : <Badge tone="neutral">Missing</Badge>}
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-[var(--color-content-subtle)] transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-3 bg-[var(--color-surface-sunken)] px-4 pb-4 sm:px-5">
          {!doc ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-4 py-3">
              <p className="text-body-sm text-[var(--color-content-muted)]">
                They haven&apos;t uploaded this yet, so they can&apos;t be verified automatically.
              </p>
              {onAsk && (
                <Button size="sm" variant="outline" disabled={asking || asked} onClick={onAsk}>
                  <Send size={14} /> {asked ? 'Asked' : asking ? 'Sending…' : 'Ask for it'}
                </Button>
              )}
            </div>
          ) : (
            <>
              <DocumentPreview doc={doc} />

              {doc.status === 'rejected' && doc.note && (
                <p className="rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-3 py-2 text-body-sm text-[var(--color-danger-500)]">
                  Rejected: {doc.note}
                </p>
              )}

              {rejecting ? (
                <RejectForm busy={busy} onCancel={onCancelReject} onConfirm={(note) => onDecide('rejected', note)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {doc.status !== 'verified' && (
                    <Button size="sm" disabled={busy} onClick={() => onDecide('verified')}>
                      <CheckCircle2 size={15} /> Approve
                    </Button>
                  )}
                  {doc.status !== 'rejected' && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={onStartReject}>
                      <XCircle size={15} /> Reject
                    </Button>
                  )}
                  {doc.status === 'verified' && (
                    <span className="self-center text-caption text-[var(--color-content-subtle)]">
                      Approved. You can still reject it if something turns out to be wrong.
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** The file itself, inline: an image or a PDF, with a way out to a full tab. */
function DocumentPreview({ doc }: { doc: VerificationReviewItem }) {
  const [broken, setBroken] = useState(false);
  const url = useQuery({
    queryKey: ['kycDocUrl', doc.storagePath],
    queryFn: () => client.getKycDocumentUrl(doc.storagePath!),
    enabled: !!doc.storagePath,
    // Signed URLs are short-lived; refetch rather than show a dead link.
    staleTime: 30_000,
  });

  if (!doc.storagePath) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-raised)] px-3 py-3 text-body-sm text-[var(--color-content-muted)]">
        <FileText size={16} className="shrink-0" /> No file on record — this was submitted before files were
        stored.
      </div>
    );
  }
  if (url.isLoading) return <Skeleton className="h-64 w-full" />;
  if (url.isError || !url.data) {
    return (
      <p className="rounded-[var(--radius-control)] bg-[var(--color-surface-raised)] px-3 py-3 text-body-sm text-[var(--color-danger-500)]">
        Couldn&apos;t open this file.{' '}
        <button type="button" className="underline" onClick={() => url.refetch()}>
          Try again
        </button>
      </p>
    );
  }

  const name = doc.fileName ?? doc.storagePath;
  const isPdf = /\.pdf$/i.test(name);

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]">
      {isPdf ? (
        <iframe title={DOC_TYPE_LABEL[doc.type]} src={url.data} className="h-[28rem] w-full" />
      ) : broken ? (
        <p className="px-3 py-8 text-center text-body-sm text-[var(--color-content-muted)]">
          This file can&apos;t be previewed here. Open it in a new tab to look at it.
        </p>
      ) : (
        <a href={url.data} target="_blank" rel="noopener noreferrer" className="block bg-black/5">
          <img
            src={url.data}
            alt={DOC_TYPE_LABEL[doc.type]}
            onError={() => setBroken(true)}
            className="mx-auto max-h-[28rem] w-auto object-contain"
          />
        </a>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-2 text-caption">
        <span className="flex min-w-0 items-center gap-1.5 text-[var(--color-content-muted)]">
          <FileText size={13} className="shrink-0" />
          <span className="truncate">{name}</span>
        </span>
        <a
          href={url.data}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-medium text-[var(--color-accent-on)] hover:underline"
        >
          Open <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

function RejectForm({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2.5 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-3">
      <p className="text-body-sm font-medium text-[var(--color-content)]">Why? They&apos;ll see this.</p>
      <div className="flex flex-wrap gap-1.5">
        {REJECTION_REASONS.map((r) => (
          <Chip key={r} selected={note === r} onClick={() => setNote(r)} className="text-left">
            {r}
          </Chip>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Or write your own reason…"
        className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" disabled={busy || !note.trim()} onClick={() => onConfirm(note.trim())}>
          Reject document
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A decision about the whole account rather than one document — for when the
 * documents can't tell the story (someone verified in person, a fraud case).
 * It sticks: later document changes no longer recompute the status until the
 * override is cleared, which is why each option says so before it's applied.
 */
function AccountDecision({ person }: { person: KycPerson }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<VerificationStatus | null>(null);
  const [note, setNote] = useState('');

  const override = useMutation({
    mutationFn: (status: VerificationStatus) =>
      client.overrideProfileVerification(person.id, status, note.trim() || undefined),
    onSuccess: (_r, status) => {
      invalidateKyc(qc);
      qc.invalidateQueries({ queryKey: ['userActions', person.id] });
      setPending(null);
      setNote('');
      toast.success(`${person.fullName} is now ${VERIFICATION_META[status].label.toLowerCase()}.`);
      void relayVerificationToPayhold(person.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't change the status."),
  });
  const clear = useMutation({
    mutationFn: () => client.clearVerificationOverride(person.id),
    // Clearing hands the status back to the documents, which may change it.
    onSuccess: () => {
      invalidateKyc(qc);
      toast.success('Status now follows their documents again.');
      void relayVerificationToPayhold(person.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't clear the override."),
  });

  const options: { status: VerificationStatus; label: string; variant: 'secondary' | 'outline' | 'ghost' }[] = [
    { status: 'verified', label: 'Verify account', variant: 'secondary' },
    { status: 'rejected', label: 'Reject account', variant: 'outline' },
    { status: 'unverified', label: 'Mark not verified', variant: 'ghost' },
  ];
  const needsReason = pending === 'rejected';

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[var(--color-content-subtle)]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-[var(--color-content)]">Decide for the whole account</h3>
          <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
            {person.verificationOverride
              ? "An admin set this account's status, so document changes don't update it."
              : 'Usually not needed: approving every required document verifies them automatically.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options
              .filter((o) => o.status !== person.verification || !person.verificationOverride)
              .map((o) => (
                <Button key={o.status} size="sm" variant={o.variant} onClick={() => setPending(o.status)}>
                  {o.label}
                </Button>
              ))}
            {person.verificationOverride && (
              <Button size="sm" variant="outline" disabled={clear.isPending} onClick={() => clear.mutate()}>
                Follow documents again
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        tone={pending === 'verified' ? 'primary' : 'danger'}
        title={pending ? `${options.find((o) => o.status === pending)?.label}?` : ''}
        confirmLabel={pending ? options.find((o) => o.status === pending)?.label : undefined}
        busy={override.isPending}
        onClose={() => {
          setPending(null);
          setNote('');
        }}
        onConfirm={() => {
          if (!pending || (needsReason && !note.trim())) return;
          override.mutate(pending);
        }}
        body={
          <div className="space-y-3">
            <p>
              {person.fullName} will be marked{' '}
              <span className="font-medium">{pending ? VERIFICATION_META[pending].label.toLowerCase() : ''}</span>{' '}
              regardless of their documents, until someone chooses &ldquo;Follow documents again&rdquo;.
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={needsReason ? 'Reason (required)…' : 'Note for the audit log (optional)…'}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-body-sm text-[var(--color-content)] placeholder:text-[var(--color-content-subtle)] focus:border-[var(--color-accent-on)] focus:outline-none"
            />
            {needsReason && !note.trim() && (
              <p className="text-caption text-[var(--color-content-subtle)]">Add a reason to reject the account.</p>
            )}
          </div>
        }
      />
    </Card>
  );
}

const EVENT_LABEL: Record<VerificationEventKind, string> = {
  submitted: 'Uploaded',
  resubmitted: 'Uploaded again',
  approved: 'Approved',
  rejected: 'Rejected',
  override: 'Status set to',
  updated: 'Updated',
};

const EVENT_DOT: Record<VerificationEventKind, string> = {
  submitted: 'bg-[var(--color-info-500)]',
  resubmitted: 'bg-[var(--color-info-500)]',
  approved: 'bg-[var(--color-accent-on)]',
  rejected: 'bg-[var(--color-danger-500)]',
  override: 'bg-[var(--color-content)]',
  updated: 'bg-[var(--color-line-strong)]',
};

function eventText(e: VerificationEvent): string {
  if (e.event === 'override') return `${EVENT_LABEL.override} ${VERIFICATION_META[e.status].label.toLowerCase()}`;
  return `${EVENT_LABEL[e.event] ?? e.event}${e.docType ? ` ${DOC_TYPE_LABEL[e.docType].toLowerCase()}` : ''}`;
}

function PersonHistory({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const events = useQuery({
    queryKey: ['kycEvents', profileId],
    queryFn: () => client.listKycEvents({ profileId, pageSize: 25 }),
    enabled: open,
  });
  const items = events.data?.items ?? [];

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5"
      >
        <History size={16} className="shrink-0 text-[var(--color-content-subtle)]" />
        <span className="flex-1 text-body-sm font-medium text-[var(--color-content)]">History</span>
        <ChevronDown
          size={16}
          className={cn('text-[var(--color-content-subtle)] transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--color-line)] px-4 py-3 sm:px-5">
          {events.isLoading ? (
            <Spinner size={16} />
          ) : items.length === 0 ? (
            <p className="text-body-sm text-[var(--color-content-muted)]">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {items.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', EVENT_DOT[e.event] ?? 'bg-[var(--color-line-strong)]')} />
                  <div className="min-w-0 text-body-sm">
                    <p className="text-[var(--color-content)]">
                      {eventText(e)}
                      {e.actorName && e.actorId !== profileId && (
                        <span className="text-[var(--color-content-muted)]"> by {e.actorName}</span>
                      )}
                    </p>
                    {e.note && <p className="text-[var(--color-content-muted)]">&ldquo;{e.note}&rdquo;</p>}
                    <p className="tabular text-caption text-[var(--color-content-subtle)]">{timeAgo(e.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}

/** Platform switch: verify new submissions instantly, or hold them for review. */
function AutoApproveSwitch() {
  const qc = useQueryClient();
  const { data: on, isLoading } = useQuery({
    queryKey: ['kycAutoApprove'],
    queryFn: () => client.getKycAutoApprove(),
  });
  const toggle = useMutation({
    mutationFn: (next: boolean) => client.setKycAutoApprove(next),
    onSuccess: (_r, next) => {
      qc.invalidateQueries({ queryKey: ['kycAutoApprove'] });
      toast.success(next ? 'New documents are now approved automatically.' : 'New documents now wait for review.');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't change the setting."),
  });

  return (
    <Card className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-[var(--color-content)]">Approve new documents automatically</p>
        <p className="text-caption text-[var(--color-content-subtle)]">
          {on
            ? 'On — uploads are approved the moment they arrive. Turn off to review each one here.'
            : 'Off — every upload waits in this queue for a decision.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!on}
        aria-label="Approve new documents automatically"
        disabled={isLoading || toggle.isPending}
        onClick={() => toggle.mutate(!on)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-[var(--radius-pill)] transition-colors disabled:opacity-50',
          on ? 'bg-[var(--color-accent-on)]' : 'bg-[var(--color-line-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            on ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </Card>
  );
}
