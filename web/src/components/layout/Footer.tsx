import { Link } from 'react-router-dom';
import { Car } from 'lucide-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { PaymentMethods } from '@/components/marketplace/PaymentMethods';

const LINK_COLUMNS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: 'Explore',
    links: [
      { to: '/', label: 'Browse cars' },
      // Wording matches the homepage "Ask AI" bar exactly (HomePage.tsx) —
      // positioned as research, not an assistant/chat product.
      { to: '/ai', label: 'Research with AI' },
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
    // Desktop only. A native phone app has no "About us" footer — the tab
    // bar is the footer there, and legal/about lives under Account — so
    // below `md` this renders nothing at all rather than a shorter version.
    // Hiding it here (not in the shell) keeps the shell's tab-bar padding
    // the single thing that reserves space above the bar.
    //
    // Quiet by design — a footer competing for attention is a footer that
    // looks like another CTA. Sunken ground + a hairline top border read as
    // "you've reached the bottom of the page," not "look here."
    <footer className="mt-12 hidden border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] md:block">
      <div className="mx-auto max-w-[1500px] px-4 py-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          {/* Brand — wordmark in ink, not the accent. The logo mark keeps its
              filled brand chip (a fixed emblem, not a control), but the text
              next to it is not "act on this." No blurb under it: the product
              explains itself on the page above. */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2 font-bold text-[var(--color-content)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-brand-600 text-white">
                <Car size={18} />
              </span>
              <span className="text-body-lg">AutoHire</span>
            </div>
          </div>

          {/* Quick links */}
          <nav className="grid grid-cols-2 gap-x-12 gap-y-6 sm:gap-x-16">
            {LINK_COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
                  {col.heading}
                </p>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.to}>
                      <Link
                        to={l.to}
                        className="text-body-sm text-[var(--color-content-muted)] transition-colors hover:text-[var(--color-content)]"
                      >
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
            <p className="text-caption font-semibold tracking-wide text-[var(--color-content-subtle)] uppercase">
              We accept
            </p>
            <PaymentMethods title="" className="mt-3" />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-[var(--color-line)] pt-6 text-caption text-[var(--color-content-subtle)] sm:flex-row">
          <p>© {year} AutoHire. All rights reserved.</p>
          {isAdmin && (
            <Link to="/admin" className="hover:text-[var(--color-content)]">
              Admin
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
