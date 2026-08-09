import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * The last step: hand the renter to the provider's own page.
 *
 * This used to frame PayHold's checkout so the renter never left. PayHold asked
 * us not to, for two reasons worth recording. Their page carries its own
 * payment-method picker, so framing it puts a second chooser inside ours and
 * asks the same question twice. And the frame does not end at PayHold anyway —
 * it hands off to Flutterwave or Stripe to take the money, and Stripe Checkout
 * refuses to be framed at all, so the rail that most needs to work is the one
 * that breaks.
 *
 * So the modal holds the *choice*, and the payment takes the whole tab. The
 * booking is created by the signed `order.funded_held` webhook either way, so a
 * renter who never comes back still gets their trip.
 */
export function PayholdHandover({ paymentLink }: { paymentLink: string }) {
  const [leaving, setLeaving] = useState(false);

  // Go on our own after a beat. The button is for pop-up blockers, a slow
  // connection, and anyone who would rather press it themselves.
  useEffect(() => {
    const t = setTimeout(() => {
      setLeaving(true);
      window.location.assign(paymentLink);
    }, 1200);
    return () => clearTimeout(t);
  }, [paymentLink]);

  return (
    <div className="rounded-xl border border-ink-200 p-5 text-center">
      <p className="font-medium text-ink-900">
        {leaving ? 'Taking you to the secure checkout…' : 'Opening the secure checkout…'}
      </p>
      <p className="mt-1 text-sm text-ink-600">
        You'll finish paying on our payment provider's page, then come straight back.
      </p>
      <Button className="mt-4" onClick={() => window.location.assign(paymentLink)}>
        Continue to payment
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-500">
        <Lock size={12} className="text-brand-600" />
        Your card details are entered there, never on AutoHire.
      </p>
    </div>
  );
}
