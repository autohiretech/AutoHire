import { useQuery } from '@tanstack/react-query';
import { FileText, ShieldCheck, Star } from 'lucide-react';
import { client } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { Avatar, Badge, Button, Modal, Spinner } from '@/components/ui';

export const VERIF_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  verified: 'success',
  pending: 'warning',
  rejected: 'danger',
  unverified: 'neutral',
};

/**
 * Review a requester (profile + verification documents) before deciding on their
 * booking. Used by hosts — individuals and companies alike — wherever a pending
 * request is acted on (dashboard and car detail).
 */
export function RequesterModal({
  open,
  onClose,
  renterId,
  onDecide,
  deciding,
}: {
  open: boolean;
  onClose: () => void;
  renterId: string;
  onDecide: (action: 'approve' | 'decline') => void;
  deciding: boolean;
}) {
  const profileQuery = useQuery({
    queryKey: ['profile', renterId],
    queryFn: () => client.getProfile(renterId),
    enabled: open,
  });
  const docsQuery = useQuery({
    queryKey: ['verificationDocs', renterId],
    queryFn: () => client.listVerificationDocumentsFor(renterId),
    enabled: open,
  });
  const p = profileQuery.data;
  const docs = docsQuery.data ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Review requester">
      {profileQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} />
        </div>
      ) : !p ? (
        <p className="text-sm text-ink-500">Couldn't load this profile.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={p.fullName} src={p.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold text-ink-900">{p.fullName}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge tone={VERIF_TONE[p.verification] ?? 'neutral'}>
                  <ShieldCheck size={12} /> {p.verification}
                </Badge>
                {p.ratingCount ? (
                  <span className="inline-flex items-center gap-1 text-sm text-ink-500">
                    <Star size={13} className="fill-accent-500 text-accent-500" />
                    {p.ratingAvg?.toFixed(1)} ({p.ratingCount})
                  </span>
                ) : (
                  <span className="text-sm text-ink-400">No ratings yet</span>
                )}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink-500">Phone</dt>
              <dd className="font-medium text-ink-900">{p.phone || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Joined</dt>
              <dd className="font-medium text-ink-900">{p.joinedAt ? formatDate(p.joinedAt) : '—'}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-700">Documents</p>
            {docsQuery.isLoading ? (
              <Spinner size={18} />
            ) : docs.length === 0 ? (
              <p className="text-sm text-ink-500">No documents uploaded.</p>
            ) : (
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-ink-800">
                      <FileText size={15} className="text-ink-400" />
                      <span className="capitalize">{String(d.type).replace(/_/g, ' ')}</span>
                      {d.fileName && <span className="text-xs text-ink-400">· {d.fileName}</span>}
                    </span>
                    <Badge tone={VERIF_TONE[d.status] ?? 'neutral'}>{d.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
            <Button variant="outline" onClick={() => onDecide('decline')} disabled={deciding}>
              Decline
            </Button>
            <Button onClick={() => onDecide('approve')} disabled={deciding}>
              Approve
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
