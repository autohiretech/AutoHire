import { Link } from 'react-router-dom';
import { CarFront, ShieldCheck } from 'lucide-react';
import type { Host } from '@autohire/shared';

/** Compact host tile — links to the host's public profile. */
export function HostCard({ host }: { host: Host }) {
  const isBusiness = host.ownerType === 'business';
  const name = host.businessName || host.fullName;
  return (
    <Link
      to={`/hosts/${host.id}`}
      className="flex flex-col items-center rounded-2xl border border-ink-100 bg-white p-4 text-center shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover"
    >
      {host.avatarUrl ? (
        <img src={host.avatarUrl} alt={name} className="h-14 w-14 rounded-full object-cover" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-ink-900">{name}</p>
      <p className="text-xs capitalize text-ink-500">
        {isBusiness ? 'Business host' : 'Individual host'}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-600">
        <span className="flex items-center gap-1">
          <CarFront size={13} className="text-ink-400" /> {host.vehicleCount}
        </span>
        {host.verification === 'verified' && (
          <span className="flex items-center gap-1 text-brand-600">
            <ShieldCheck size={13} /> Verified
          </span>
        )}
      </div>
    </Link>
  );
}
