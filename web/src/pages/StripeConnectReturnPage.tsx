import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Card, CardBody, Spinner } from '@/components/ui';

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
        <div className="flex justify-center py-10">
          <Spinner size={26} />
        </div>
      ) : status.data?.status === 'connected' ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardBody className="space-y-3">
            <CheckCircle2 size={32} className="mx-auto text-emerald-600" />
            <p className="font-semibold text-ink-900">Stripe account connected</p>
            <p className="text-sm text-ink-600">
              Payouts go to {status.data.maskedDestination}. New accounts are verified before
              they're paid, so this pauses for up to 24 hours — your cars stay bookable meanwhile.
            </p>
            <Link to="/payouts/setup">
              <Button className="w-full">Back to payout setup</Button>
            </Link>
          </CardBody>
        </Card>
      ) : status.data?.status === 'pending' ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardBody className="space-y-3">
            <Clock size={32} className="mx-auto text-amber-600" />
            <p className="font-semibold text-ink-900">Still finishing up</p>
            <p className="text-sm text-ink-600">
              Stripe hasn't confirmed your account is ready yet — this can take a minute, or you may
              have left before finishing.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => status.refetch()}>
                Check again
              </Button>
              <Button className="flex-1" disabled={resume.isPending} onClick={() => resume.mutate()}>
                {resume.isPending ? 'Opening…' : 'Continue on Stripe'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card className="border-ink-200">
          <CardBody className="space-y-3">
            <XCircle size={32} className="mx-auto text-ink-400" />
            <p className="font-semibold text-ink-900">Nothing to pick up here</p>
            <p className="text-sm text-ink-600">
              We don't have an onboarding in progress for your account. Start from payout setup.
            </p>
            <Link to="/payouts/setup">
              <Button className="w-full">Go to payout setup</Button>
            </Link>
          </CardBody>
        </Card>
      )}
    </section>
  );
}
