import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserCheck } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button, toast } from '@/components/ui';

/**
 * Follow/unfollow — one-way, role-agnostic (migration 059). Unlike watching a
 * car, there's no renter-only restriction: a host following another host, or
 * a renter following a host, are both the normal case.
 *
 * Hidden entirely for your own profile and while signed out — following is
 * something you do to someone else, and a signed-out visitor has nowhere for
 * the relationship to attach to.
 */
export function FollowButton({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();

  const { data: following, isLoading } = useQuery({
    queryKey: ['isFollowing', profileId],
    queryFn: () => client.isFollowing(profileId),
    enabled: !!me && me.id !== profileId,
  });

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await client.follow(profileId);
      else await client.unfollow(profileId);
      await queryClient.invalidateQueries({ queryKey: ['isFollowing', profileId] });
      await queryClient.invalidateQueries({ queryKey: ['followers', profileId] });
    },
    onSuccess: (_data, next) => toast.success(next ? 'Following' : 'Unfollowed'),
    onError: () => toast.error('Could not update — try again'),
  });

  if (!me || me.id === profileId) return null;

  const isFollowing = !!following;

  return (
    // Not-following is the one accent button ("Follow"); already-following
    // states the fact with the neutral outline variant rather than a second
    // hue — the toggle is fill/weight, not colour.
    <Button
      type="button"
      variant={isFollowing ? 'outline' : 'primary'}
      size="sm"
      disabled={isLoading || toggle.isPending}
      onClick={() => toggle.mutate(!isFollowing)}
    >
      {isFollowing ? <UserCheck size={15} /> : <UserPlus size={15} />}
      {isFollowing ? 'Following' : 'Follow'}
    </Button>
  );
}
