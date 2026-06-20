import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type Method = { label: string; icon: LucideIcon; color: string };

/** Every payment method AutoHire accepts — mobile money, cards, and bank transfer. */
const METHODS: Method[] = [
  { label: 'MTN MoMo', icon: Smartphone, color: '#F5B700' },
  { label: 'Airtel Money', icon: Smartphone, color: '#E40000' },
  { label: 'Visa', icon: CreditCard, color: '#1A1F71' },
  { label: 'Mastercard', icon: CreditCard, color: '#EB001B' },
  { label: 'Amex', icon: CreditCard, color: '#2E77BC' },
  { label: 'Bank transfer', icon: Landmark, color: '#0F766E' },
  { label: 'Cash on pickup', icon: Banknote, color: '#16A34A' },
];

/**
 * A row of payment-method chips, Alibaba "secure payments" style. Shown in the
 * footer (and reusable on checkout) so renters can see every accepted method.
 */
export function PaymentMethods({ title = 'We accept', className }: { title?: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {title && <span className="text-xs font-medium uppercase tracking-wide text-ink-400">{title}</span>}
      {METHODS.map((m) => (
        <span
          key={m.label}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-700"
        >
          <m.icon size={14} style={{ color: m.color }} />
          {m.label}
        </span>
      ))}
    </div>
  );
}
