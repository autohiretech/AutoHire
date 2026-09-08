import { cn } from '@/lib/cn';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'h-8 w-8 text-caption',
  md: 'h-10 w-10 text-body-sm',
  lg: 'h-14 w-14 text-body',
};

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-[var(--radius-pill)] object-cover', sizes[size], className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-[var(--radius-pill)] bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
        sizes[size],
        className,
      )}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
