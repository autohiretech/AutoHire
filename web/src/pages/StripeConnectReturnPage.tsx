import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Notice, Skeleton } from '@/components/ui';

/**
 * Where Stripe sends a host back after (or during) Connect onboarding.
 *
 * Stripe's return is not evidence of anything by itself — an abandoned
 * onboarding lands here too — so this polls PayHold's own account status
 * rather than assuming success. See `payhold-stripe-connect`'s GET handler
 * and PayHold's `sellers/:id/connect/status`.
 */
export function StripeConnectReturnPage() {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['stripeConnectStatus'],
    queryFn: () => client.stripeConnectStatus(),
    retry: false,
  });

  useEffect(() => {
    if (status.data?.status === 'connected') {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
    }
  }, [status.data?.status, queryClient]);

  const resume = useMutation({
    mutationFn: () => client.startStripeConnectOnboarding(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  return (
    <section className="mx-auto max-w-md px-4 py-16 text-center">
      {status.isLoading ? (
        <div className="flex flex-col items-center gap-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-1 h-11 w-full" />
        </div>
      ) : status.data?.status === 'connected' ? (
        <Notice tone="brand" className="flex-col items-center text-center">
          <CheckCircle2 size={32} />
          <p className="mt-1 text-body font-semibold text-[var(--color-content)]">
            Stripe account connected
          </p>
          <p>
            Payouts go to {status.data.maskedDestination}. New accounts are verified before
            they're paid, so this pauses for up to 24 hours — your cars stay bookable meanwhile.
          </p>
          <Link to="/payouts/setup" className="w-full">
            <Button className="w-full">Back to payout setup</Button>
          </Link>
        </Notice>
      ) : status.data?.status === 'pending' ? (
        <Notice tone="warn" className="flex-col items-center text-center">
          <Clock size={32} />
          <p className="mt-1 text-body font-semibold text-[var(--color-content)]">
            Still finishing up
          </p>
          <p>
            Stripe hasn't confirmed your account is ready yet — this can take a minute, or you may
            have left before finishing.
          </p>
          <div className="flex w-full gap-2">
            <Button variant="outline" className="flex-1" onClick={() => status.refetch()}>
              Check again
            </Button>
            <Button className="flex-1" disabled={resume.isPending} onClick={() => resume.mutate()}>
              {resume.isPending ? 'Opening…' : 'Continue on Stripe'}
            </Button>
          </div>
        </Notice>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] p-4">
          <div className="flex flex-col items-center gap-3">
            <XCircle size={32} className="text-[var(--color-content-subtle)]" />
            <p className="font-semibold text-[var(--color-content)]">Nothing to pick up here</p>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              We don't have an onboarding in progress for your account. Start from payout setup.
            </p>
            <Link to="/payouts/setup" className="w-full">
              <Button className="w-full">Go to payout setup</Button>
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
