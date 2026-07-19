import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Img } from '@/components/Img';
import { cn } from '@/lib/cn';

/**
 * Compact, swipeable photo carousel — one photo at a time with prev/next
 * arrows, a counter and dots. Handles any number of photos and supports touch
 * swipe. Used where a full-page gallery would be too heavy (e.g. admin cards).
 */
export function PhotoCarousel({
  photos,
  alt,
  className,
  heightClass = 'h-56',
}: {
  photos: string[];
  alt: string;
  className?: string;
  heightClass?: string;
}) {
  const [i, setI] = useState(0);
  const touchX = useRef<number | null>(null);
  if (photos.length === 0) return null;

  const idx = Math.min(i, photos.length - 1);
  const go = (d: number) => setI((p) => (p + d + photos.length) % photos.length);

  return (
    <div
      className={cn('group relative overflow-hidden rounded-xl bg-ink-100', className)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current !== null) {
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (dx > 40) go(-1);
          else if (dx < -40) go(1);
        }
        touchX.current = null;
      }}
    >
      <Img src={photos[idx]} alt={alt} className={cn('w-full object-cover', heightClass)} />

      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
          >
            <ChevronRight size={18} />
          </button>

          <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white">
            {idx + 1} / {photos.length}
          </span>

          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {photos.map((_, n) => (
              <button
                key={n}
                type="button"
                aria-label={`Go to photo ${n + 1}`}
                onClick={() => setI(n)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  n === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90',
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
