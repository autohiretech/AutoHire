/**
 * Lightweight, recognizable brand marks for payment methods, drawn inline so we
 * don't bundle proprietary raster logos. Swap in official SVGs later if desired.
 */

export function StripeWordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-bold lowercase tracking-tight ${className}`}
      style={{ color: '#635BFF' }}
    >
      stripe
    </span>
  );
}

export function VisaMark() {
  return (
    <span
      className="rounded bg-white px-1.5 py-0.5 text-xs font-bold italic"
      style={{ color: '#1A1F71', border: '1px solid #E5E7EB' }}
      aria-label="Visa"
    >
      VISA
    </span>
  );
}

export function MastercardMark() {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-label="Mastercard">
      <rect width="34" height="22" rx="3" fill="#fff" stroke="#E5E7EB" />
      <circle cx="14" cy="11" r="6" fill="#EB001B" />
      <circle cx="20" cy="11" r="6" fill="#F79E1B" fillOpacity="0.9" />
    </svg>
  );
}

/** MTN MoMo — MTN brand yellow pill. */
export function MomoMark() {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-extrabold"
      style={{ backgroundColor: '#FFCC00', color: '#04141F' }}
      aria-label="MTN Mobile Money"
    >
      MTN MoMo
    </span>
  );
}
