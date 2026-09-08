import { Construction } from 'lucide-react';

/** Stand-in for screens delivered in later parts (A1–A9). */
export function PlaceholderPage({ title, part }: { title: string; part: string }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center">
      <Construction size={40} className="text-[var(--color-content-subtle)]" />
      <h1 className="mt-4 text-h3 text-[var(--color-content)]">{title}</h1>
      <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">Coming in part {part}.</p>
    </div>
  );
}
