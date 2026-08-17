import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Calendar, LayoutGrid } from 'lucide-react';
import { client } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { ListingCard } from '@/components/ListingCard';
import { Avatar, Card, CardBody, Spinner, toast } from '@/components/ui';

/**
 * A board's pinned cars — what the group is actually weighing against each
 * other. Each pin optionally carries the dates someone's considering, which is
 * also what feeds the demand signal (`listing_demand`) back to hosts; showing
 * it here is the same data, just read by the people who put it there.
 */
export function BoardDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();

  const boardQuery = useQuery({ queryKey: ['board', id], queryFn: () => client.getBoard(id) });
  const itemsQuery = useQuery({ queryKey: ['boardItems', id], queryFn: () => client.listBoardItems(id) });

  const remove = useMutation({
    mutationFn: (listingId: string) => client.removeFromBoard(id, listingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['boardItems', id] });
      await queryClient.invalidateQueries({ queryKey: ['board', id] });
      toast.success('Removed from the board');
    },
    onError: () => toast.error('Could not remove — try again'),
  });

  if (boardQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  const board = boardQuery.data;
  if (!board) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Board not found</p>
        <Link to="/circles" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to circles
        </Link>
      </div>
    );
  }

  const items = itemsQuery.data ?? [];

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <Link
        to={board.circleId ? `/circles/${board.circleId}` : '/circles'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-900">{board.title}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {items.length} {items.length === 1 ? 'car' : 'cars'} pinned
        </p>
      </div>

      {itemsQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <LayoutGrid size={32} className="text-ink-300" />
            <div>
              <p className="font-medium text-ink-900">Nothing pinned yet</p>
              <p className="mt-1 text-sm text-ink-500">
                Open a car and use <span className="font-medium text-ink-700">Add to board</span> to
                bring it here.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.listing.id} className="flex flex-col gap-2">
              <ListingCard listing={item.listing} />
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-500">
                  <Avatar name={item.addedBy.fullName} src={item.addedBy.avatarUrl} size="sm" className="h-5 w-5" />
                  <span className="truncate">{item.addedBy.fullName.split(' ')[0]}</span>
                  {item.targetStart && (
                    <span className="flex items-center gap-1 text-ink-400">
                      <Calendar size={12} /> {formatDate(item.targetStart)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove.mutate(item.listing.id)}
                  disabled={remove.isPending}
                  className="shrink-0 text-sm font-medium text-ink-500 hover:text-ink-800 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              {item.note && <p className="px-1 text-sm text-ink-600">"{item.note}"</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
