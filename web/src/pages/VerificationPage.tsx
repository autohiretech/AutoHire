import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  FileText,
  ScanLine,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import type { Host, UserProfile, VerificationDocument, VerificationStatus } from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { formatDate } from '@/lib/format';
import {
  VERIFICATION_DOCS,
  VERIFICATION_ROLE_META,
  VERIFICATION_STATUS_META,
  overallStatus,
  verificationRoleFor,
  type DocConfig,
} from '@/lib/verification';
import { Badge, Button, ListGroup, ListRow, Notice, Skeleton } from '@/components/ui';

const STATUS_ICON: Record<VerificationStatus, React.ReactNode> = {
  unverified: <ShieldCheck size={18} className="mt-0.5 shrink-0" />,
  pending: <Clock size={18} className="mt-0.5 shrink-0" />,
  verified: <CheckCircle2 size={18} className="mt-0.5 shrink-0" />,
  rejected: <XCircle size={18} className="mt-0.5 shrink-0" />,
};

// `brand` reads as reassurance ("you're all set") rather than as an accent
// here — Notice's brand tone is the one place that's allowed. `unverified`
// isn't a problem yet, just informational, so it gets `info` rather than `warn`.
const NOTICE_TONE: Record<VerificationStatus, 'info' | 'warn' | 'brand' | 'danger'> = {
  unverified: 'info',
  pending: 'warn',
  verified: 'brand',
  rejected: 'danger',
};

const BANNER_TEXT: Record<VerificationStatus, string> = {
  unverified: 'Upload your documents to get verified.',
  pending: 'Your documents are under review — this usually takes a few hours.',
  verified: "You're fully verified.",
  rejected: 'One or more documents need attention. See below.',
};

export function VerificationPage() {
  const { data: profileData } = useCurrentUser();
  const profile = profileData as (UserProfile & Partial<Host>) | undefined;
  const role = verificationRoleFor({ role: profile?.role, ownerType: profile?.ownerType });
  const roleMeta = VERIFICATION_ROLE_META[role];

  const { data: documents, isLoading } = useQuery({
    queryKey: ['verificationDocuments'],
    queryFn: () => client.listVerificationDocuments(),
  });

  const configs = VERIFICATION_DOCS[role];
  const docsByType = new Map((documents ?? []).map((d) => [d.type, d]));
  const statuses = configs.map((c) => docsByType.get(c.type)?.status ?? 'unverified');
  const overall = overallStatus(statuses);

  return (
    <section className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h1">Verification</h1>
        <Badge tone="brand">{roleMeta.label}</Badge>
      </div>
      <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">{roleMeta.blurb}</p>

      {isLoading ? (
        <div className="mt-6 flex flex-col gap-6" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-14 w-full" />
          <ListGroup label="Documents">
            {configs.map((config) => (
              <ListRow
                key={config.type}
                icon={<Skeleton className="h-[18px] w-[18px] rounded-full" />}
                value={<Skeleton className="h-5 w-16 rounded-[var(--radius-pill)]" />}
                chevron={false}
              >
                <Skeleton className="h-4 w-32" />
              </ListRow>
            ))}
          </ListGroup>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* Overall status — the one thing on this page that genuinely needs
              the user's attention, so it leads. */}
          <Notice tone={NOTICE_TONE[overall]}>
            {STATUS_ICON[overall]}
            <p className="font-medium">{BANNER_TEXT[overall]}</p>
          </Notice>

          <ListGroup label="Documents">
            {configs.map((config) => (
              <DocRow key={config.type} config={config} doc={docsByType.get(config.type)} />
            ))}
          </ListGroup>
        </div>
      )}
    </section>
  );
}

function DocRow({ config, doc }: { config: DocConfig; doc?: VerificationDocument }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const status: VerificationStatus = doc?.status ?? 'unverified';
  const meta = VERIFICATION_STATUS_META[status];

  const mutation = useMutation({
    mutationFn: (file: File) => client.uploadVerificationDocument(config.type, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verificationDocuments'] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
  });

  return (
    <>
      <ListRow
        icon={<FileText size={18} />}
        value={<Badge tone={meta.tone}>{meta.label}</Badge>}
        onClick={() => fileRef.current?.click()}
      >
        {config.label}
      </ListRow>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) mutation.mutate(file);
          e.target.value = '';
        }}
      />

      <div className="space-y-3 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-3">
        <p className="text-body-sm text-[var(--color-content-muted)]">{config.hint}</p>

        {doc?.fileName && (
          <div className="flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-raised)] px-3 py-2 text-body-sm text-[var(--color-content)]">
            <FileText size={16} className="text-[var(--color-content-subtle)]" />
            <span className="truncate">{doc.fileName}</span>
            {doc.uploadedAt && (
              <span className="tabular ml-auto shrink-0 text-caption text-[var(--color-content-subtle)]">
                {formatDate(doc.uploadedAt)}
              </span>
            )}
          </div>
        )}

        {/* OCR-extracted fields (placeholder until Stage C wires real OCR) */}
        {doc?.extracted && (
          <dl className="grid grid-cols-1 gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-3 text-body-sm sm:grid-cols-2">
            {Object.entries(doc.extracted).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 sm:flex-col sm:gap-0">
                <dt className="text-[var(--color-content-subtle)]">{k}</dt>
                <dd className="font-medium text-[var(--color-content)]">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {status === 'pending' && !doc?.extracted && (
          <p className="flex items-center gap-1.5 text-body-sm text-[var(--color-warn-500)]">
            <ScanLine size={15} /> Uploaded — awaiting review.
          </p>
        )}

        {status === 'rejected' && doc?.note && (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-3 py-2 text-body-sm text-[var(--color-danger-500)]">
            {doc.note}
          </p>
        )}

        {/* Always `outline`, never `primary` — a checklist of several documents
            has no single "the one thing this screen does" action, and a row
            of green buttons would spend the one accent several times over. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={mutation.isPending}
        >
          <Upload size={15} />
          {mutation.isPending
            ? 'Uploading…'
            : doc?.fileName
              ? status === 'rejected'
                ? 'Re-upload'
                : 'Replace'
              : 'Upload'}
        </Button>
      </div>
    </>
  );
}
