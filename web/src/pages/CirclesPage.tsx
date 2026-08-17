import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout, Tractor, Users, Users2 } from 'lucide-react';
import type { CircleKind } from '@autohire/shared';
import { client } from '@/lib/client';
import { Button, Card, CardBody, Input, Label, Modal, Select, Spinner, toast } from '@/components/ui';

const KIND_META: Record<CircleKind, { label: string; icon: typeof Users }> = {
  crew: { label: 'Road-trip crew', icon: Users },
  cooperative: { label: 'Cooperative', icon: Tractor },
  team: { label: 'Team', icon: Users2 },
  family: { label: 'Family', icon: Sprout },
};

/**
 * Your circles — named groups a few people actually use, not a friend graph
 * waiting to get dense. A crew planning a trip, a farming cooperative sharing
 * a tractor, a company's driver pool. Useful the day it's created.
 */
export function CirclesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CircleKind>('crew');

  const circlesQuery = useQuery({ queryKey: ['circles'], queryFn: () => client.listCircles() });

  const create = useMutation({
    mutationFn: () => client.createCircle({ name: name.trim(), kind }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['circles'] });
      setCreating(false);
      setName('');
      setKind('crew');
      toast.success('Circle created');
    },
    onError: () => toast.error('Could not create the circle — try again'),
  });

  const circles = circlesQuery.data ?? [];

  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Circles</h1>
          <p className="mt-1 text-sm text-ink-500">
            Small groups you plan trips with, or share equipment through.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          New circle
        </Button>
      </div>

      {circlesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : circles.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Users size={32} className="text-ink-300" />
            <div>
              <p className="font-medium text-ink-900">No circles yet</p>
              <p className="mt-1 text-sm text-ink-500">
                Start one for a road trip, a cooperative, or anyone you regularly plan with.
              </p>
            </div>
            <Button size="sm" onClick={() => setCreating(true)}>
              New circle
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {circles.map((c) => {
            const meta = KIND_META[c.kind];
            return (
              <Link key={c.id} to={`/circles/${c.id}`}>
                <Card className="h-full transition-shadow hover:shadow-card-hover">
                  <CardBody className="flex items-start gap-3">
                    <div className="rounded-lg bg-brand-50 p-2 text-brand-700">
                      <meta.icon size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-900">{c.name}</p>
                      <p className="text-sm text-ink-500">
                        {meta.label} · {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
                      </p>
                      {c.myStatus === 'invited' && (
                        <p className="mt-1 text-xs font-medium text-accent-600">Invitation pending</p>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New circle">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <Label htmlFor="circle-name">Name</Label>
            <Input
              id="circle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bugesera Farmers Co-op"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="circle-kind">Type</Label>
            <Select id="circle-kind" value={kind} onChange={(e) => setKind(e.target.value as CircleKind)}>
              {(Object.keys(KIND_META) as CircleKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending} className="w-full">
            {create.isPending ? 'Creating…' : 'Create circle'}
          </Button>
        </form>
      </Modal>
    </section>
  );
}
