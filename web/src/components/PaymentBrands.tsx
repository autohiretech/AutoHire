import type { ReactNode } from 'react';
import type { PaymentMethodType } from '@autohire/shared';

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

/** Alipay — its brand blue, with the wordmark it is recognised by. */
export function AlipayMark() {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: '#1677FF' }}
      aria-label="Alipay"
    >
      Alipay
    </span>
  );
}

/** WeChat Pay — WeChat green. */
export function WeChatPayMark() {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: '#07C160' }}
      aria-label="WeChat Pay"
    >
      WeChat Pay
    </span>
  );
}

/** Venmo — its blue wordmark. */
export function VenmoMark() {
  return (
    <span className="text-sm font-bold" style={{ color: '#008CFF' }} aria-label="Venmo">
      venmo
    </span>
  );
}

/** Cash App — brand green. */
export function CashAppMark() {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: '#00D64F' }}
      aria-label="Cash App"
    >
      Cash App
    </span>
  );
}

/**
 * A bank transfer has no brand to show — the renter's own bank is the brand, and
 * we do not know which it is. A neutral mark keeps the row from looking unfinished
 * beside the ones that do have logos.
 */
export function BankMark() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: '#EEF2F5', color: '#33414D' }}
      aria-label="Bank transfer"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5 15 5v1.4H1V5L8 1.5Z" fill="currentColor" />
        <rect x="3" y="7.6" width="1.9" height="5" fill="currentColor" />
        <rect x="7.05" y="7.6" width="1.9" height="5" fill="currentColor" />
        <rect x="11.1" y="7.6" width="1.9" height="5" fill="currentColor" />
        <rect x="1.6" y="13.4" width="12.8" height="1.5" rx="0.5" fill="currentColor" />
      </svg>
      Bank
    </span>
  );
}

/**
 * A card brand at a size you can actually read across a room.
 *
 * The marks above are sized to ride inside a method row, next to a label that
 * already says "card". These stand alone — on a screen whose only button is
 * "Pay", the strip of brands *is* the answer to the one question a renter has
 * before pressing it: will mine work? So they get a real tile, not a footnote.
 */
function BrandTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-9 w-14 items-center justify-center rounded-lg border border-ink-200 bg-white shadow-sm"
    >
      {children}
    </span>
  );
}

/** The card networks AutoHire takes, drawn big. */
export function AcceptedCards({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <BrandTile label="Visa">
        <span className="text-sm font-black italic tracking-tight" style={{ color: '#1A1F71' }}>
          VISA
        </span>
      </BrandTile>

      <BrandTile label="Mastercard">
        <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
          <circle cx="14" cy="11" r="7.5" fill="#EB001B" />
          <circle cx="21" cy="11" r="7.5" fill="#F79E1B" fillOpacity="0.85" />
        </svg>
      </BrandTile>

      <BrandTile label="American Express">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-black tracking-tight text-white"
          style={{ backgroundColor: '#2E77BC' }}
        >
          AMEX
        </span>
      </BrandTile>

      <BrandTile label="Discover">
        <span className="text-[10px] font-black tracking-tight" style={{ color: '#1A1F36' }}>
          DISC<span style={{ color: '#FF6000' }}>●</span>VER
        </span>
      </BrandTile>
    </div>
  );
}

/**
 * What each payment method actually accepts, as the marks people recognise.
 *
 * "Card" means nothing until you see Visa and Mastercard under it; "Mobile
 * Money" means nothing until you see MTN and Airtel. These answer the question
 * the label leaves open — *will mine work?* — before the renter commits to a
 * choice and finds out on someone else's page.
 */
export function MethodMarks({ method }: { method: PaymentMethodType }) {
  switch (method) {
    case 'card':
      return (
        <>
          <VisaMark />
          <MastercardMark />
          <AmexMark />
        </>
      );
    case 'momo':
      return (
        <>
          <MomoMark />
          <AirtelMark />
        </>
      );
    case 'bank':
      return <BankMark />;
    case 'paypal':
      return <PayPalMark />;
    case 'alipay':
      return <AlipayMark />;
    case 'wechat_pay':
      return <WeChatPayMark />;
  }
}
