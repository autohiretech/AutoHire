/**
 * The AutoHire mark.
 *
 * A fastback in profile, facing forward, over two road dashes. One silhouette:
 * the body is a single even-odd path with the glass and the wheel arches cut
 * out of it, the wheels sit inside their arches with a hub hole, and the road
 * runs underneath with the nearer dash longer. Low, long and closed — the
 * shape of the car people come here to drive, not the upright hatchback every
 * icon set ships. Drawn once here and once in `scripts/gen-brand.mjs`, which
 * rasterises the same geometry into the app icons; change one and re-run
 * the other.
 *
 * It takes its colour from `currentColor`, so it sits inside whatever tile
 * the surrounding screen already draws (the accent chip in the header, the
 * brand chip in the footer) and inherits ink when drawn bare. The 64-unit
 * box is the glyph's own bounds, so `size` is the mark's visible size.
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
      fill="currentColor"
      fillRule="evenodd"
    >
      <path d="M 6 35.5 L 6 30.5 Q 6 26.5 10.5 26 L 17 25 Q 24 15 33 14.5 Q 39 14.5 43.5 17.5 L 47 21.5 L 55 23.5 Q 58 24 58 27 L 58 35.5 Q 58 38 55.5 38 L 8.5 38 Q 6 38 6 35.5 Z M 21 25 Q 27 18.5 33.5 18 L 38 18 L 43.5 23 Z M 11.8 38 A 7.2 7.2 0 0 1 26.2 38 Z M 38.8 38 A 7.2 7.2 0 0 1 53.2 38 Z" />
      <path d="M 13.8 38 a 5.2 5.2 0 1 0 10.4 0 a 5.2 5.2 0 1 0 -10.4 0 M 17.1 38 a 1.9 1.9 0 1 0 3.8 0 a 1.9 1.9 0 1 0 -3.8 0" />
      <path d="M 40.8 38 a 5.2 5.2 0 1 0 10.4 0 a 5.2 5.2 0 1 0 -10.4 0 M 44.1 38 a 1.9 1.9 0 1 0 3.8 0 a 1.9 1.9 0 1 0 -3.8 0" />
      <rect x="8" y="46" width="19" height="3.5" rx="1.75" />
      <rect x="32" y="46" width="10" height="3.5" rx="1.75" />
    </svg>
  );
}
