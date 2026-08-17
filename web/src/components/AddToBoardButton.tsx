import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Plus } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button, Input, Modal, toast } from '@/components/ui';

/**
 * "Add to board" — the collaborative-wishlist half of the social layer
 * (migration 062). Sits beside Watch on the car page but does a different job:
 * a watch is "tell me when this is free", a board pin is "we're considering
 * this" and is visible to whoever else is on the board.
 *
 * Signed-in only. Unlike watching, there's no guest/localStorage fallback —
 * a board is inherently about being seen by other people, which a browser-only
 * list can't do.
 */
export function AddToBoardButton({ listingId }: { listingId: string }) {
  const { data: me } = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const boardsQuery = useQuery({
    queryKey: ['boards', 'mine'],
    queryFn: () => client.listBoards(),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (boardId: string) => client.addToBoard({ boardId, listingId }),
    onSuccess: (_data, boardId) => {
      const board = boardsQuery.data?.find((b) => b.id === boardId);
      toast.success(`Added to ${board?.title ?? 'the board'}`);
      setOpen(false);
    },
    onError: () => toast.error('Could not add to that board — try again'),
  });

  const createAndAdd = useMutation({
    mutationFn: async () => {
      const board = await client.createBoard({ title: newTitle.trim() });
      await client.addToBoard({ boardId: board.id, listingId });
      return board;
    },
    onSuccess: async (board) => {
      await queryClient.invalidateQueries({ queryKey: ['boards', 'mine'] });
      toast.success(`Added to ${board.title}`);
      setNewTitle('');
      setOpen(false);
    },
    onError: () => toast.error('Could not create the board — try again'),
  });

  if (!me) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pin to a board"
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
      >
        <LayoutGrid size={16} />
        <span className="hidden sm:inline">Add to board</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add to board">
        <div className="flex flex-col gap-3">
          {boardsQuery.isLoading ? (
            <p className="text-sm text-ink-500">Loading your boards…</p>
          ) : (boardsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-500">You don't have a board yet — create one below.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {(boardsQuery.data ?? []).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => add.mutate(b.id)}
                  disabled={add.isPending}
                  className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2.5 text-left text-sm hover:bg-ink-50 disabled:opacity-50"
                >
                  <span className="font-medium text-ink-800">{b.title}</span>
                  <span className="text-ink-400">
                    {b.itemCount} {b.itemCount === 1 ? 'car' : 'cars'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newTitle.trim()) createAndAdd.mutate();
            }}
            className="flex items-center gap-2 border-t border-ink-100 pt-3"
          >
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New board name"
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={!newTitle.trim() || createAndAdd.isPending}>
              <Plus size={15} /> Create
            </Button>
          </form>
        </div>
      </Modal>
    </>
  );
}
