import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LayoutGrid, Link2, LogOut } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Avatar, Badge, Button, Card, CardBody, ConfirmDialog, Spinner, toast } from '@/components/ui';

/**
 * A circle's home: who's in it, an invite link to grow it, and the boards its
 * members share. There's no "friend request" flow to review here — the only
 * invite path (migration 063) is a share link, so joining is a single click
 * on the far end, not an accept/decline the owner has to manage.
 */
export function CircleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [leaving, setLeaving] = useState(false);

  const circleQuery = useQuery({ queryKey: ['circle', id], queryFn: () => client.getCircle(id) });
  const membersQuery = useQuery({
    queryKey: ['circleMembers', id],
    queryFn: () => client.listCircleMembers(id),
  });
  const boardsQuery = useQuery({
    queryKey: ['boards', id],
    queryFn: () => client.listBoards(id),
  });

  const invite = useMutation({
    mutationFn: () => client.createCircleInviteLink(id),
    onSuccess: async (inv) => {
      const url = `${window.location.origin}/invite/${inv.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Invite link copied — share it on WhatsApp, SMS, anywhere');
      } catch {
        toast.success(url);
      }
    },
    onError: () => toast.error('Could not create an invite link — try again'),
  });

  const newBoard = useMutation({
    mutationFn: () => client.createBoard({ title: `${circleQuery.data?.name ?? 'Circle'} board`, circleId: id }),
    onSuccess: async (board) => {
      await queryClient.invalidateQueries({ queryKey: ['boards', id] });
      navigate(`/boards/${board.id}`);
    },
    onError: () => toast.error('Could not create a board — try again'),
  });

  const leave = useMutation({
    mutationFn: () => client.leaveCircle(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['circles'] });
      toast.success('Left the circle');
      navigate('/circles');
    },
    onError: () => toast.error('Could not leave — try again'),
  });

  if (circleQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  const circle = circleQuery.data;
  if (!circle) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Circle not found</p>
        <Link to="/circles" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to circles
        </Link>
      </div>
    );
  }

  const members = membersQuery.data ?? [];
  const boards = boardsQuery.data ?? [];
  const isOwner = members.find((m) => m.profile.id === me?.id)?.role === 'owner';

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/circles"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back to circles
      </Link>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900">{circle.name}</h1>
            <p className="text-sm text-ink-500">
              {circle.memberCount} {circle.memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => invite.mutate()} disabled={invite.isPending}>
              <Link2 size={15} /> Invite link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLeaving(true)}
              className="text-ink-500"
              title="Leave circle"
            >
              <LogOut size={15} />
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Members */}
      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink-900">Members</h2>
        {membersQuery.isLoading ? (
          <Spinner size={20} />
        ) : (
          <div className="flex flex-wrap gap-3">
            {members.map((m) => (
              <div key={m.profile.id} className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2">
                <Avatar name={m.profile.fullName} src={m.profile.avatarUrl} size="sm" />
                <span className="text-sm font-medium text-ink-800">{m.profile.fullName}</span>
                {m.role === 'owner' && <Badge tone="brand">Owner</Badge>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Boards */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">Boards</h2>
          <Button size="sm" variant="outline" onClick={() => newBoard.mutate()} disabled={newBoard.isPending}>
            New board
          </Button>
        </div>
        {boardsQuery.isLoading ? (
          <Spinner size={20} />
        ) : boards.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-10 text-center text-ink-500">
              <LayoutGrid size={24} className="text-ink-300" />
              <p className="text-sm">No boards yet — pin cars here for the group to weigh in on.</p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {boards.map((b) => (
              <Link key={b.id} to={`/boards/${b.id}`}>
                <Card className="h-full transition-shadow hover:shadow-card-hover">
                  <CardBody>
                    <p className="font-semibold text-ink-900">{b.title}</p>
                    <p className="text-sm text-ink-500">
                      {b.itemCount} {b.itemCount === 1 ? 'car' : 'cars'} pinned
                    </p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={leaving}
        title="Leave this circle?"
        body={
          isOwner && members.length > 1
            ? "You're the owner — leaving won't delete the circle, but you'll lose the ability to manage it."
            : 'You can rejoin later with a new invite link.'
        }
        confirmLabel="Leave"
        tone="danger"
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onClose={() => setLeaving(false)}
      />
    </section>
  );
}
