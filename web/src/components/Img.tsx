import { useState, type ImgHTMLAttributes } from 'react';
import { PHOTO_FALLBACK, resolvePhoto } from '@/lib/images';

/**
 * Resilient <img> for listing photos. It:
 *  - rewrites slow demo URLs to a fast CDN via {@link resolvePhoto};
 *  - lazy-loads and async-decodes by default, so a full grid doesn't stampede
 *    the network on first paint (off-screen cards fetch only when scrolled to);
 *  - swaps to an inline placeholder when an image fails, instead of leaving the
 *    browser's permanent broken-image icon.
 *
 * A drop-in for `<img>` — same props, plus an optional `fallback`.
 */
export function Img({
  src,
  fallback = PHOTO_FALLBACK,
  loading = 'lazy',
  decoding = 'async',
  onError,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { fallback?: string }) {
  const resolved = resolvePhoto(typeof src === 'string' ? src : undefined);
  // Track the src that errored (not a boolean) so a new src prop retries cleanly
  // and we never re-flag the fallback itself, which would loop.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const showFallback = erroredSrc === resolved && resolved !== fallback;
  return (
    <img
      src={showFallback ? fallback : resolved}
      loading={loading}
      decoding={decoding}
      onError={(e) => {
        setErroredSrc(resolved);
        onError?.(e);
      }}
      {...rest}
    />
  );
}
