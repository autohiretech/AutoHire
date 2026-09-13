/**
 * The AutoHire mark.
 *
 * An "A" whose crossbar is the road: two lane dashes, the nearer one wider,
 * so the letter also reads as a road running away from you. Nothing else —
 * no car silhouette, no steering wheel — because the product is the road
 * trip and the name starts with the letter. Drawn once here and once in
 * `scripts/gen-brand.mjs`, which rasterises the same geometry into the app
 * icons; change one and re-run the other.
 *
 * It takes its colour from `currentColor`, so it sits inside whatever tile
 * the surrounding screen already draws (the accent chip in the header, the
 * brand chip in the footer) and inherits ink when drawn bare. The 64-unit
 * box is the glyph's own bounds with the stroke's round caps included, so
 * `size` is the mark's visible size and not a padded one.
 */
export function BrandMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M15 53 L32 11 L49 53"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="27.6" y="38.4" width="8.8" height="5.2" rx="1.8" fill="currentColor" />
      <rect x="29.8" y="28.2" width="4.4" height="3.8" rx="1.3" fill="currentColor" />
    </svg>
  );
}
