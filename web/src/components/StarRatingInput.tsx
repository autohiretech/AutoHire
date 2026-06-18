import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Clickable 1–5 star rating input. */
export function StarRatingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          <Star
            size={26}
            className={cn(
              'transition-colors',
              n <= active ? 'fill-accent-500 text-accent-500' : 'text-ink-300',
            )}
          />
        </button>
      ))}
    </div>
  );
}
