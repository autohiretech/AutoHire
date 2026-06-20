import { Link } from 'react-router-dom';
import { Car } from 'lucide-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { PaymentMethods } from '@/components/marketplace/PaymentMethods';

const LINK_COLUMNS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: 'Explore',
    links: [
      { to: '/', label: 'Browse cars' },
      { to: '/cars/new', label: 'List your car' },
    ],
  },
  {
    heading: 'Your account',
    links: [
      { to: '/trips', label: 'My trips' },
      { to: '/verification', label: 'Verification' },
      { to: '/account', label: 'Account' },
    ],
  },
];

export function Footer() {
  const { data: profile } = useCurrentUser();
  const isAdmin = profile?.role === 'admin';
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-ink-200 bg-ink-50/40">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          {/* Brand */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2 font-bold text-brand-700">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Car size={18} />
              </span>
              <span className="text-lg">AutoHire</span>
            </div>
            <p className="mt-3 text-sm text-ink-500">
              Peer-to-peer car rental — rent from people and agencies, or earn by hosting your car.
            </p>
          </div>

          {/* Quick links */}
          <nav className="grid grid-cols-2 gap-x-12 gap-y-6 sm:gap-x-16">
            {LINK_COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{col.heading}</p>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.to}>
                      <Link to={l.to} className="text-sm text-ink-600 transition-colors hover:text-brand-700">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {/* Payments */}
          <div className="lg:max-w-xs">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">We accept</p>
            <PaymentMethods title="" className="mt-3" />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-ink-200 pt-6 text-xs text-ink-400 sm:flex-row">
          <p>© {year} AutoHire. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span>Secure payments · Verified hosts</span>
            {isAdmin && (
              <Link to="/admin" className="hover:text-ink-700">
                Admin
              </Link>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
