import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Star } from 'lucide-react';
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
 * Review a requester before deciding on their booking. Used by hosts —
 * individuals and companies alike — wherever a pending request is acted on
 * (dashboard and car detail). Hosts see the platform's verification decision,
 * not the renter's raw ID documents (those stay private to the renter + admins).
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
  const p = profileQuery.data;

  return (
    <Modal open={open} onClose={onClose} title="Review requester">
      {profileQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} />
        </div>
      ) : !p ? (
        <p className="text-body-sm text-[var(--color-content-muted)]">Couldn't load this profile.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={p.fullName} src={p.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold text-[var(--color-content)]">{p.fullName}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge tone={VERIF_TONE[p.verification] ?? 'neutral'}>
                  <ShieldCheck size={12} /> {p.verification}
                </Badge>
                {p.ratingCount ? (
                  <span className="inline-flex items-center gap-1 text-body-sm text-[var(--color-content-muted)]">
                    <Star size={13} className="fill-[var(--color-accent-on)] text-[var(--color-accent-on)]" />
                    {p.ratingAvg?.toFixed(1)} ({p.ratingCount})
                  </span>
                ) : (
                  <span className="text-body-sm text-[var(--color-content-subtle)]">No ratings yet</span>
                )}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-body-sm">
            <div>
              <dt className="text-caption text-[var(--color-content-muted)]">Phone</dt>
              <dd className="font-medium text-[var(--color-content)]">{p.phone || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-caption text-[var(--color-content-muted)]">Joined</dt>
              <dd className="font-medium text-[var(--color-content)]">{p.joinedAt ? formatDate(p.joinedAt) : '—'}</dd>
            </div>
          </dl>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5 text-body-sm">
            <p className="font-medium text-[var(--color-content)]">Identity verification</p>
            <p className="mt-0.5 text-[var(--color-content-muted)]">
              {p.verification === 'verified'
                ? 'AutoHire has verified this renter’s identity documents.'
                : p.verification === 'pending'
                  ? 'Documents submitted — verification is still in review.'
                  : p.verification === 'rejected'
                    ? 'Verification was not passed. Consider declining or requesting resubmission.'
                    : 'This renter has not completed identity verification yet.'}
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
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
