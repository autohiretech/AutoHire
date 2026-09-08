import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Car, ChevronRight, Globe, Lock, Megaphone, Rss, Users } from 'lucide-react';
import type { FeedItem, PostVisibility } from '@autohire/shared';
import { client } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { CAR_CATEGORIES } from '@/lib/categories';
import { Img } from '@/components/Img';
import { Avatar, Badge, Button, Card, CardBody, Spinner } from '@/components/ui';

const VISIBILITY_ICON: Record<PostVisibility, typeof Globe> = {
  public: Globe,
  circles: Users,
  private: Lock,
};

const CATEGORY_LABEL = Object.fromEntries(CAR_CATEGORIES.map((c) => [c.value, c.label]));

/**
 * The verified feed — two different kinds of card, deliberately told apart.
 * A trip post is backed by trip_post_guard (migration 064): it cannot exist
 * unless it's about a paid, completed booking the author was actually on,
 * including the seeded launch posts, whose `isDemo` flag this page is honest
 * about. A broadcast (migration 067) carries none of that — it's a host
 * talking to their followers with no trip behind it — so it never gets the
 * verified styling a trip post does.
 *
 * Deliberately its own route, not a replacement for the home page — search
 * stays the front door; this is where you go to see what people are actually
 * renting, and what hosts are saying.
 */
export function FeedPage() {
  const feedQuery = useQuery({ queryKey: ['feed'], queryFn: () => client.listFeed() });
  const items = feedQuery.data ?? [];

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-h2 text-[var(--color-content)]">Feed</h1>
        <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
          Trips people you follow or share a circle with actually took.
        </p>
      </div>

      {feedQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Rss size={32} className="text-[var(--color-content-subtle)]" />
            <div>
              <p className="font-medium text-[var(--color-content)]">Nothing here yet</p>
              <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
                Follow a host or join a circle, and their trips will show up here.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) =>
            item.kind === 'trip' ? (
              <TripPostCard key={`trip-${item.id}`} post={item} />
            ) : (
              <BroadcastCard key={`bcast-${item.id}`} broadcast={item} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function TripPostCard({ post }: { post: Extract<FeedItem, { kind: 'trip' }> }) {
  const VisIcon = VISIBILITY_ICON[post.visibility];
  return (
    <Card>
      <CardBody className="space-y-3">
        {/* The person is the subject of this card — bigger avatar than a
            broadcast gets, name first, the car is further down and smaller. */}
        <div className="flex items-center gap-3">
          <Avatar name={post.author.fullName} src={post.author.avatarUrl} size="md" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-body-sm font-semibold text-[var(--color-content)]">
              {post.author.fullName}
              {post.isDemo && <Badge tone="neutral">Sample</Badge>}
            </p>
            <p className="flex items-center gap-1 text-caption text-[var(--color-content-subtle)]">
              {formatDate(post.createdAt)}
              <span>·</span>
              <VisIcon size={11} />
              {post.city && <span>· {post.city}</span>}
            </p>
            {post.authorPreferredCategories && post.authorPreferredCategories.length > 0 && (
              <p className="mt-0.5 text-caption text-[var(--color-content-muted)]">
                Usually books:{' '}
                <span className="font-medium text-[var(--color-content)]">
                  {post.authorPreferredCategories.map((c) => CATEGORY_LABEL[c] ?? c).join(' · ')}
                </span>
              </p>
            )}
          </div>
        </div>

        {post.body && <p className="text-body-sm text-[var(--color-content)]">{post.body}</p>}

        {/* The experience — this is the card's hero image, not a car shot. */}
        {post.photos.length > 0 && (
          <div className={post.photos.length > 1 ? 'grid grid-cols-2 gap-1.5' : ''}>
            {post.photos.slice(0, 4).map((url, i) => (
              <Img
                key={i}
                src={url}
                alt=""
                className="h-48 w-full rounded-[var(--radius-card)] object-cover"
              />
            ))}
          </div>
        )}

        {/* The car — a slim reference, not a second photo. It already has its
            own gallery on the listing page; this card doesn't repeat it. */}
        {post.listing && (
          <Link
            to={`/cars/${post.listing.id}`}
            className="flex items-center gap-1.5 text-caption font-medium text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
          >
            <Car size={13} /> {post.listing.title}
            <ChevronRight size={13} />
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

/** No visibility icon, no "verified" styling — this is a host talking, not a
    checked trip. Told apart from a trip post with a plain "Update" badge and
    a megaphone glyph, not a full-card tint — that tint is reserved for a
    state (a warning, a failure), and a broadcast isn't one. */
function BroadcastCard({ broadcast }: { broadcast: Extract<FeedItem, { kind: 'broadcast' }> }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={broadcast.host.fullName} src={broadcast.host.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-body-sm font-semibold text-[var(--color-content)]">
              {broadcast.host.businessName ?? broadcast.host.fullName}
            </p>
            <p className="text-caption text-[var(--color-content-subtle)]">
              {formatDate(broadcast.createdAt)}
            </p>
          </div>
          <Badge tone="neutral">
            <Megaphone size={11} /> Update
          </Badge>
        </div>

        <p className="text-body-sm text-[var(--color-content)]">{broadcast.body}</p>

        {broadcast.listing && (
          <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-2">
            <Img
              src={broadcast.listing.photos[0]}
              alt={broadcast.listing.title}
              className="h-14 w-20 shrink-0 rounded-[var(--radius-control)] object-cover"
            />
            <p className="min-w-0 flex-1 truncate text-body-sm font-medium text-[var(--color-content)]">
              {broadcast.listing.title}
            </p>
            <Link to={`/cars/${broadcast.listing.id}`} className="shrink-0">
              <Button size="sm" variant="outline">
                View car
              </Button>
            </Link>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
