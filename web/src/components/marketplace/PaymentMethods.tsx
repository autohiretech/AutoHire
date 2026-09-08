import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type Method = { label: string; icon: LucideIcon; color?: string };

/** Every payment method AutoHire accepts — mobile money, cards, and bank
 * transfer. Colours are real third-party brand marks (MTN/Airtel/card
 * networks) and stay fixed hex regardless of theme — a legitimate exception
 * to the token system, same as any other brand logo. "Bank transfer" and
 * "Cash on pickup" have no brand identity of their own, so they carry no
 * colour at all rather than an invented one. */
const METHODS: Method[] = [
  { label: 'MTN MoMo', icon: Smartphone, color: '#F5B700' },
  { label: 'Airtel Money', icon: Smartphone, color: '#E40000' },
  { label: 'Visa', icon: CreditCard, color: '#1A1F71' },
  { label: 'Mastercard', icon: CreditCard, color: '#EB001B' },
  { label: 'Amex', icon: CreditCard, color: '#2E77BC' },
  { label: 'Bank transfer', icon: Landmark },
  { label: 'Cash on pickup', icon: Banknote },
];

/**
 * A row of payment-method chips, Alibaba "secure payments" style. Shown in the
 * footer (and reusable on checkout) so renters can see every accepted method.
 */
export function PaymentMethods({ title = 'We accept', className }: { title?: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {title && (
        <span className="text-caption font-medium tracking-wide text-[var(--color-content-subtle)] uppercase">
          {title}
        </span>
      )}
      {METHODS.map((m) => (
        <span
          key={m.label}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] px-2 py-1 text-caption font-medium text-[var(--color-content-muted)]"
        >
          <m.icon size={14} style={m.color ? { color: m.color } : undefined} />
          {m.label}
        </span>
      ))}
    </div>
  );
}
