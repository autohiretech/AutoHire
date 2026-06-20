import { useState, type FormEvent } from 'react';
import { Search, Sparkles } from 'lucide-react';
import type { CarCategory } from '@autohire/shared';
import { cn } from '@/lib/cn';
import { CAR_CATEGORIES } from '@/lib/categories';

/**
 * Alibaba-style fused search bar with an "AI Mode" toggle. In Standard mode it's
 * a category dropdown + keyword input. In AI mode the dropdown gives way to a
 * natural-language box: the query is sent to Claude (server-side) and turned
 * into filters via `onAiSearch`. Category changes apply instantly; the keyword /
 * AI query applies on submit.
 */
export function MegaSearch({
  category,
  onCategoryChange,
  query,
  onSearch,
  onAiSearch,
  aiBusy = false,
}: {
  category?: CarCategory;
  onCategoryChange: (category?: CarCategory) => void;
  query: string;
  onSearch: (query: string) => void;
  onAiSearch: (query: string) => void;
  aiBusy?: boolean;
}) {
  const [text, setText] = useState(query);
  const [aiMode, setAiMode] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (aiMode) onAiSearch(q);
    else onSearch(q);
  }

  return (
    <div>
      {/* Mode toggle */}
      <div className="mb-2 inline-flex rounded-full bg-white/15 p-0.5 text-sm">
        {[
          { key: false, label: 'Standard' },
          { key: true, label: 'AI Mode', icon: Sparkles },
        ].map((m) => (
          <button
            key={String(m.key)}
            type="button"
            onClick={() => setAiMode(m.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3.5 py-1 font-medium transition-colors',
              aiMode === m.key ? 'bg-white text-brand-700 shadow-sm' : 'text-white/90 hover:text-white',
            )}
          >
            {m.icon && <m.icon size={14} />}
            {m.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={submit}
        className={cn(
          'flex items-stretch overflow-hidden rounded-full border-2 bg-white shadow-sm',
          aiMode ? 'border-accent-500 focus-within:border-accent-500' : 'border-brand-500 focus-within:border-brand-600',
        )}
      >
        {aiMode ? (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-l-full border-r border-ink-200 bg-amber-50 px-4 text-sm font-medium text-amber-700 sm:flex">
            <Sparkles size={15} /> AI
          </span>
        ) : (
          <select
            value={category ?? ''}
            onChange={(e) => onCategoryChange((e.target.value || undefined) as CarCategory | undefined)}
            aria-label="Category"
            className="hidden shrink-0 cursor-pointer rounded-l-full border-r border-ink-200 bg-ink-50 px-4 text-sm font-medium text-ink-700 outline-none sm:block"
          >
            <option value="">All categories</option>
            {CAR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            aiMode
              ? 'Describe the car you want — e.g. “cheap automatic SUV for 5 people”'
              : 'Search cars by make, model, or keyword'
          }
          aria-label={aiMode ? 'Describe the car you want' : 'Search cars'}
          className="min-w-0 flex-1 px-4 py-3 text-sm text-ink-900 outline-none placeholder:text-ink-400"
        />
        <button
          type="submit"
          disabled={aiBusy}
          className={cn(
            'flex shrink-0 items-center gap-2 px-5 font-medium text-white transition-colors disabled:opacity-70',
            aiMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand-600 hover:bg-brand-700',
          )}
        >
          {aiMode ? <Sparkles size={18} /> : <Search size={18} />}
          <span className="hidden sm:inline">{aiBusy ? 'Thinking…' : aiMode ? 'Ask AI' : 'Search'}</span>
        </button>
      </form>
    </div>
  );
}
