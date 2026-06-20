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

export function AmexMark() {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: '#2E77BC' }}
      aria-label="American Express"
    >
      AMEX
    </span>
  );
}

export function DiscoverMark() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs font-bold"
      style={{ color: '#1A1F36', border: '1px solid #E5E7EB' }}
      aria-label="Discover"
    >
      DISC<span style={{ color: '#FF6000' }}>●</span>VER
    </span>
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

/** Airtel Money — Airtel brand red pill. */
export function AirtelMark() {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-extrabold text-white"
      style={{ backgroundColor: '#E40000' }}
      aria-label="Airtel Money"
    >
      Airtel
    </span>
  );
}

export function PayPalMark() {
  return (
    <span className="text-sm font-bold italic" aria-label="PayPal">
      <span style={{ color: '#003087' }}>Pay</span>
      <span style={{ color: '#0070E0' }}>Pal</span>
    </span>
  );
}

export function GooglePayMark() {
  return (
    <span className="inline-flex items-center text-sm font-medium" aria-label="Google Pay">
      <span style={{ color: '#4285F4' }}>G</span>
      <span style={{ color: '#EA4335' }}>o</span>
      <span style={{ color: '#FBBC05' }}>o</span>
      <span style={{ color: '#4285F4' }}>g</span>
      <span style={{ color: '#34A853' }}>l</span>
      <span style={{ color: '#EA4335' }}>e</span>
      <span className="ml-1 text-ink-700">Pay</span>
    </span>
  );
}
