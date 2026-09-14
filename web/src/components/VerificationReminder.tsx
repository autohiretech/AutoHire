import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button, Modal } from '@/components/ui';
import {
  VERIFICATION_DOCS,
  effectiveVerificationStatus,
  verificationRoleFor,
} from '@/lib/verification';
import type { Host, UserProfile } from '@autohire/shared';

/**
 * A reminder that verification is unfinished — not a gate.
 *
 * **Renting has never required verification and still doesn't.** That was
 * removed from nine places deliberately: a renter can book at any status,
 * including rejected. So this reminds, it does not block, and it says what
 * being verified is actually worth rather than implying anything is withheld.
 *
 * It is also the difference between a host who thinks they are verified and
 * one who knows they aren't: the documents a role owes change when the role
 * does, and someone who became a host yesterday has two documents they have
 * never been asked for.
 *
 * **The restraint is the feature.** Once a week at most, once per account, and
 * never on the verification page itself. A reminder that appears on every load
 * is not a reminder, it is a toll gate on someone else's app — and the account
 * it nags is one that has already been told.
 */

/** Remembered per account, so a shared device doesn't silence someone else's. */
const DISMISS_KEY = 'autohire.verificationReminder';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function snoozedUntil(profileId: string): number {
  try {
    const raw = window.localStorage.getItem(`${DISMISS_KEY}.${profileId}`);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    // Private windows and blocked site data throw on access. A reminder that
    // cannot remember it was dismissed would show on every load, which is
    // worse than not showing at all — so treat it as permanently snoozed.
    return Number.POSITIVE_INFINITY;
  }
}

function snooze(profileId: string) {
  try {
    window.localStorage.setItem(`${DISMISS_KEY}.${profileId}`, String(Date.now() + WEEK_MS));
  } catch {
    /* nothing to do — see above */
  }
}

export function VerificationReminder() {
  const navigate = useNavigate();
  const { data } = useCurrentUser();
  const profile = data as (UserProfile & Partial<Host>) | undefined;
  const [open, setOpen] = useState(false);

  const role = verificationRoleFor({ role: profile?.role, ownerType: profile?.ownerType });

  // Only asked for once there is someone to ask about, and only when their
  // stored status leaves room for it — an account already marked verified
  // costs nothing to skip, and this is the common case.
  const { data: documents } = useQuery({
    queryKey: ['verificationDocuments'],
    queryFn: () => client.listVerificationDocuments(),
    enabled: Boolean(profile) && profile?.verification !== 'verified',
  });

  const configs = VERIFICATION_DOCS[role];
  const missing = documents
    ? configs.filter((c) => {
        const status = documents.find((d) => d.type === c.type)?.status;
        return !status || status === 'unverified' || status === 'rejected';
      })
    : [];

  const status = effectiveVerificationStatus({
    accountStatus: profile?.verification,
    decidedByAdmin: profile?.verificationOverride === true,
    docStatuses: configs.map(
      (c) => documents?.find((d) => d.type === c.type)?.status ?? 'unverified',
    ),
  });

  useEffect(() => {
    if (!profile || !documents) return;
    // Nothing to chase: either it is done, or it is with a reviewer and
    // hurrying them is not this person's job.
    if (status === 'verified' || status === 'pending') return;
    if (missing.length === 0) return;
    if (Date.now() < snoozedUntil(profile.id)) return;
    if (window.location.pathname.startsWith('/verification')) return;
    setOpen(true);
    // Snoozed on appearance, not on dismissal: closing it with Escape or a
    // click outside is still an answer, and the alternative is it returning
    // on the next navigation.
    snooze(profile.id);
  }, [profile?.id, documents, status, missing.length]);

  if (!profile) return null;

  const rejected = status === 'rejected';

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={rejected ? 'One of your documents needs another look' : 'Finish verifying your account'}
    >
      <div className="space-y-4">
        <p className="text-body-sm text-[var(--color-content-muted)]">
          {role === 'renter'
            ? 'You can book without this — verification is optional for renting. Verified renters stand out to hosts deciding on a request.'
            : 'You can list without this. Renters see an unverified badge on your cars until it is done.'}
        </p>

        <ul className="space-y-2">
          {missing.map((doc) => (
            <li
              key={doc.type}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-3"
            >
              <p className="text-body-sm font-medium text-[var(--color-content)]">{doc.label}</p>
              <p className="mt-0.5 text-caption text-[var(--color-content-muted)]">{doc.hint}</p>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setOpen(false);
              navigate('/verification');
            }}
          >
            <ShieldCheck size={16} /> {rejected ? 'Fix it now' : 'Add them now'}
          </Button>
          <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </div>
      </div>
    </Modal>
  );
}
