import { Construction } from 'lucide-react';

/** Stand-in for screens delivered in later parts (A1–A9). */
export function PlaceholderPage({ title, part }: { title: string; part: string }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center">
      <Construction size={40} className="text-ink-300" />
      <h1 className="mt-4 text-xl font-semibold text-ink-900">{title}</h1>
      <p className="mt-1 text-sm text-ink-500">Coming in part {part}.</p>
    </div>
  );
}
