import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Calendar, LayoutGrid } from 'lucide-react';
import { client } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { ListingCard } from '@/components/ListingCard';
import { Avatar, Card, CardBody, Skeleton, toast } from '@/components/ui';

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
    return <BoardDetailSkeleton />;
  }

  const board = boardQuery.data;
  if (!board) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-[var(--color-content)]">Board not found</p>
        <Link
          to="/circles"
          className="mt-3 inline-block text-body-sm text-[var(--color-accent-on)] hover:underline"
        >
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
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        <ArrowLeft size={16} /> Back
      </Link>

      <div className="mb-6">
        <h1 className="text-h2 text-[var(--color-content)]">{board.title}</h1>
        <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
          {items.length} {items.length === 1 ? 'car' : 'cars'} pinned
        </p>
      </div>

      {itemsQuery.isLoading ? (
        <BoardItemsSkeleton />
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <LayoutGrid size={32} className="text-[var(--color-content-subtle)]" />
            <div>
              <p className="font-medium text-[var(--color-content)]">Nothing pinned yet</p>
              <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
                Open a car and use{' '}
                <span className="font-medium text-[var(--color-content)]">Add to board</span> to bring
                it here.
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
                <div className="flex min-w-0 items-center gap-1.5 text-caption text-[var(--color-content-muted)]">
                  <Avatar
                    name={item.addedBy.fullName}
                    src={item.addedBy.avatarUrl}
                    size="sm"
                    className="h-5 w-5"
                  />
                  <span className="truncate">{item.addedBy.fullName.split(' ')[0]}</span>
                  {item.targetStart && (
                    <span className="tabular flex items-center gap-1 text-[var(--color-content-subtle)]">
                      <Calendar size={12} /> {formatDate(item.targetStart)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove.mutate(item.listing.id)}
                  disabled={remove.isPending}
                  className="shrink-0 text-body-sm font-medium text-[var(--color-content-muted)] hover:text-[var(--color-content)] disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              {item.note && (
                <p className="px-1 text-body-sm text-[var(--color-content-muted)]">"{item.note}"</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** One card's loaded shape — photo, title, location, price, then the
 * added-by row below it — with content removed. Mirrors `ListingCard` +
 * the attribution row so the grid doesn't resize when items land. */
function BoardItemsSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-full">
            <Skeleton className="aspect-[4/3] w-full" />
            <div className="space-y-1.5 pt-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-1.5 h-4 w-16" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-1">
            <Skeleton className="h-5 w-5 rounded-[var(--radius-pill)]" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The whole page's loaded shape — back link, title + count line, item
 * grid — with content removed. */
function BoardDetailSkeleton() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-6" aria-busy="true" aria-label="Loading">
      <div className="mb-4 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)]">
        <ArrowLeft size={16} /> Back
      </div>

      <div className="mb-6 space-y-1.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-24" />
      </div>

      <BoardItemsSkeleton />
    </section>
  );
}
