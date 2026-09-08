import { Link } from 'react-router-dom';
import { CarFront, ShieldCheck } from 'lucide-react';
import type { Host } from '@autohire/shared';
import { Card } from '@/components/ui';

/** Compact host tile — links to the host's public profile. */
export function HostCard({ host }: { host: Host }) {
  const isBusiness = host.ownerType === 'business';
  const name = host.businessName || host.fullName;
  return (
    <Link to={`/hosts/${host.id}`} className="block">
      <Card interactive className="flex flex-col items-center p-4 text-center">
        {host.avatarUrl ? (
          <img src={host.avatarUrl} alt={name} className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-h4 font-semibold text-brand-700">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <p className="mt-2 line-clamp-1 text-body-sm font-semibold text-[var(--color-content)]">
          {name}
        </p>
        <p className="text-caption capitalize text-[var(--color-content-muted)]">
          {isBusiness ? 'Business host' : 'Individual host'}
        </p>
        <div className="mt-2 flex items-center gap-2 text-caption text-[var(--color-content-muted)]">
          <span className="tabular flex items-center gap-1">
            <CarFront size={13} className="text-[var(--color-content-subtle)]" /> {host.vehicleCount}
          </span>
          {host.verification === 'verified' && (
            <span className="flex items-center gap-1 text-[var(--color-accent-on)]">
              <ShieldCheck size={13} /> Verified
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
