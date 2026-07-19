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
import { cn } from '@/lib/cn';
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
import { Badge, Button, Card, CardBody, CardHeader, Spinner } from '@/components/ui';

const STATUS_ICON: Record<VerificationStatus, React.ReactNode> = {
  unverified: <ShieldCheck size={18} />,
  pending: <Clock size={18} />,
  verified: <CheckCircle2 size={18} />,
  rejected: <XCircle size={18} />,
};

const BANNER_STYLES: Record<VerificationStatus, string> = {
  unverified: 'bg-ink-50 text-ink-700',
  pending: 'bg-orange-50 text-orange-800',
  verified: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-red-50 text-red-800',
};

const BANNER_TEXT: Record<VerificationStatus, string> = {
  unverified: 'Upload your documents to get verified.',
  pending: 'Your documents are under review — this usually takes a few hours.',
  verified: "You're fully verified. ",
  rejected: 'One or more documents need attention. See the notes below.',
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
    <section className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-ink-900">Verification</h1>
        <Badge tone="brand">{roleMeta.label}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-500">{roleMeta.blurb}</p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : (
        <>
          {/* Overall status banner */}
          <div
            className={cn(
              'mt-6 flex items-center gap-3 rounded-xl px-4 py-3',
              BANNER_STYLES[overall],
            )}
          >
            {STATUS_ICON[overall]}
            <p className="text-sm font-medium">{BANNER_TEXT[overall]}</p>
          </div>

          <div className="mt-5 space-y-4">
            {configs.map((config) => (
              <DocCard key={config.type} config={config} doc={docsByType.get(config.type)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function DocCard({ config, doc }: { config: DocConfig; doc?: VerificationDocument }) {
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
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink-900">{config.label}</h2>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">{config.hint}</p>

        {doc?.fileName && (
          <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
            <FileText size={16} className="text-ink-400" />
            <span className="truncate">{doc.fileName}</span>
            {doc.uploadedAt && (
              <span className="ml-auto shrink-0 text-xs text-ink-400">
                {formatDate(doc.uploadedAt)}
              </span>
            )}
          </div>
        )}

        {/* OCR-extracted fields (placeholder until Stage C wires real OCR) */}
        {doc?.extracted && (
          <dl className="grid grid-cols-1 gap-1.5 rounded-lg border border-ink-100 p-3 text-sm sm:grid-cols-2">
            {Object.entries(doc.extracted).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 sm:flex-col sm:gap-0">
                <dt className="text-ink-400">{k}</dt>
                <dd className="font-medium text-ink-800">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {status === 'pending' && !doc?.extracted && (
          <p className="flex items-center gap-1.5 text-sm text-orange-700">
            <ScanLine size={15} /> Uploaded — awaiting review.
          </p>
        )}

        {status === 'rejected' && doc?.note && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{doc.note}</p>
        )}

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
        <Button
          variant={doc?.fileName ? 'outline' : 'primary'}
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
      </CardBody>
    </Card>
  );
}
