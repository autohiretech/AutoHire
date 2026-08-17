import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Card, CardBody, CardHeader, Select, toast } from '@/components/ui';

/**
 * "Post an update" — the blueprint's Module 6 broadcast, with no trip behind
 * it (unlike TripPostComposer). Lives on the host dashboard because posting
 * is a host action, not something that happens on a specific car's page.
 * `host_broadcast_guard` (migration 067) refuses a listing that isn't
 * actually the caller's, so the picker here is a convenience, not the gate.
 */
export function HostBroadcastComposer() {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [listingId, setListingId] = useState('');

  const listingsQuery = useQuery({ queryKey: ['ownerListings'], queryFn: () => client.listOwnerListings() });

  const mutation = useMutation({
    mutationFn: () => client.createHostBroadcast({ body, listingId: listingId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      setBody('');
      setListingId('');
      toast.success('Posted to your followers');
    },
    onError: () => toast.error('Could not post — try again'),
  });

  return (
    <Card className="mt-5">
      <CardHeader>
        <h2 className="flex items-center gap-1.5 font-semibold text-ink-900">
          <Megaphone size={16} className="text-accent-600" /> Post an update
        </h2>
      </CardHeader>
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) mutation.mutate();
          }}
          className="space-y-3"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="New car added, a seasonal discount, anything your followers should know…"
            className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              className="w-auto max-w-[240px]"
            >
              <option value="">No specific car</option>
              {(listingsQuery.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" disabled={!body.trim() || mutation.isPending}>
              {mutation.isPending ? 'Posting…' : 'Post'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
