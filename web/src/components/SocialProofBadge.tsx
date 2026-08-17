import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Avatar } from '@/components/ui';

/** "Sarah" / "Sarah and Dave" / "Sarah, Dave, and 3 others". */
function namesLine(names: string[]): string {
  const first = names.map((n) => n.split(' ')[0]);
  if (first.length === 1) return first[0];
  if (first.length === 2) return `${first[0]} and ${first[1]}`;
  const shown = first.slice(0, 2);
  const rest = first.length - shown.length;
  return `${shown.join(', ')}, and ${rest} other${rest === 1 ? '' : 's'}`;
}

/**
 * "Trusted by your circle" — the badge the whole social layer exists to earn.
 * Backed by `social_proof_for_listing` (migration 060), which can only ever
 * name people the SIGNED-IN caller follows who completed a PAID booking on
 * this exact car — never a claim the renter can't independently verify by
 * looking at who they follow.
 *
 * Renders nothing rather than an empty state: a car with no social proof
 * should look like every other car, not like it's missing something.
 */
export function SocialProofBadge({ listingId }: { listingId: string }) {
  const { data: me } = useCurrentUser();
  const { data } = useQuery({
    queryKey: ['socialProof', listingId],
    queryFn: () => client.socialProof(listingId),
    enabled: !!me,
  });

  const renters = data?.circleRenters ?? [];
  if (renters.length === 0) return null;

  const names = renters.map((r) => r.fullName);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
      <div className="flex -space-x-2">
        {renters.slice(0, 4).map((r) => (
          <Avatar key={r.id} name={r.fullName} src={r.avatarUrl} size="sm" className="ring-2 ring-brand-50" />
        ))}
      </div>
      <p className="text-sm text-brand-800">
        <Users size={14} className="mr-1 inline -mt-0.5" />
        <span className="font-medium">Trusted by your circle</span> — {namesLine(names)}{' '}
        {renters.length === 1 ? 'rented' : 'have rented'} this exact car.
      </p>
    </div>
  );
}
