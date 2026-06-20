import { useEffect, useState } from 'react';
import { ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';

type Slide = {
  title: string;
  body: string;
  icon: typeof Sparkles;
  className: string;
};

/** Static promo slides — the marketplace's "deals" strip. */
const SLIDES: Slide[] = [
  {
    title: 'Self-drive cars, booked in minutes',
    body: 'Browse verified hosts, request to book, and pay securely — all in one place.',
    icon: Sparkles,
    className: 'from-brand-600 to-brand-700',
  },
  {
    title: 'Pay your way',
    body: 'MTN MoMo, Airtel Money, or local bank transfer. No card required.',
    icon: Wallet,
    className: 'from-emerald-600 to-emerald-700',
  },
  {
    title: 'Verified hosts & protected trips',
    body: 'Every host is ID-verified, and every booking is tracked end to end.',
    icon: ShieldCheck,
    className: 'from-ink-800 to-ink-900',
  },
];

/** Full-width rotating banner that cycles the promo slides every few seconds. */
export function PromoBanner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 5000);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDES[index];
  const Icon = slide.icon;

  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-r p-6 text-white sm:p-8', slide.className)}>
      <div className="flex items-start gap-4">
        <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 sm:flex">
          <Icon size={24} />
        </span>
        <div className="max-w-xl">
          <h2 className="text-xl font-bold sm:text-2xl">{slide.title}</h2>
          <p className="mt-1.5 text-sm text-white/85">{slide.body}</p>
        </div>
      </div>
      <div className="mt-5 flex gap-1.5">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show slide ${i + 1}`}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70',
            )}
          />
        ))}
      </div>
    </div>
  );
}
