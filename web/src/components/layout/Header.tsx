import { Link, NavLink } from 'react-router-dom';
import { Bell, Car, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui';
import { currentUser } from '@/mocks/data';

const navItems = [
  { to: '/', label: 'Explore' },
  { to: '/dashboard', label: 'Host dashboard' },
  { to: '/trips', label: 'My trips' },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-brand-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Car size={18} />
          </span>
          <span className="text-lg">AutoHire</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <button className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Messages">
            <MessageSquare size={20} />
          </button>
          <button className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Notifications">
            <Bell size={20} />
          </button>
          <Avatar name={currentUser.fullName} src={currentUser.avatarUrl} size="sm" className="ml-1" />
        </div>
      </div>
    </header>
  );
}
