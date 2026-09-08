import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Merge conditional class names while letting later Tailwind utilities win.
 *
 * tailwind-merge only knows Tailwind's stock utilities. Two things in our
 * theme fall outside that and, left untaught, make it *remove* classes it
 * thinks are duplicates:
 *
 * • The type scale (`text-h1` … `text-caption`) is ours. Untaught, an unknown
 *   `text-*` is filed as a text COLOUR, so `cn('text-[var(--color-x)]',
 *   'text-body-sm')` keeps only the size and drops the colour. That is how a
 *   button ended up with text the same colour as its background.
 * • `text-[var(--color-…)]` is a colour, but a bare `var()` is ambiguous to
 *   the merger. Naming our `--color-` / `--shadow-` prefixes settles it.
 *
 * Registering both means a size and a colour never conflict, while two sizes
 * (or two colours) still resolve to the last one, which is the whole point of
 * merging.
 */
const TYPE_SCALE = ['display', 'h1', 'h2', 'h3', 'h4', 'body-lg', 'body', 'body-sm', 'caption'];
const isColorVar = (v: string) => /^\[var\(--color-|^\(--color-/.test(v);
const isShadowVar = (v: string) => /^\[var\(--shadow-|^\(--shadow-/.test(v);

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_SCALE }],
      'text-color': [{ text: [isColorVar] }],
      'bg-color': [{ bg: [isColorVar] }],
      'border-color': [{ border: [isColorVar] }],
      'ring-color': [{ ring: [isColorVar] }],
      'outline-color': [{ outline: [isColorVar] }],
      'divide-color': [{ divide: [isColorVar] }],
      'placeholder-color': [{ placeholder: [isColorVar] }],
      fill: [{ fill: [isColorVar] }],
      stroke: [{ stroke: [isColorVar] }],
      shadow: [{ shadow: [isShadowVar] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
