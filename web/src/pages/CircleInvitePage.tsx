import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Card, CardBody, Spinner } from '@/components/ui';

/**
 * Where a share link (migration 063) lands. Wrapped in RequireAuth by the
 * route, so by the time this renders the visitor is signed in — a guest gets
 * bounced to /login first and back here after, same as every other
 * account-only page. Claiming is one call: the token IS the credential, and
 * it's single-use, so a second visit to the same link just says so.
 */
export function CircleInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<'claiming' | 'joined' | 'invalid'>('claiming');
  const claimedRef = useRef(false);

  useEffect(() => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    client
      .claimCircleInvite(token)
      .then((circleId) => {
        if (circleId) {
          setState('joined');
          setTimeout(() => navigate(`/circles/${circleId}`, { replace: true }), 1200);
        } else {
          setState('invalid');
        }
      })
      .catch(() => setState('invalid'));
  }, [token, navigate]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <Card className="w-full">
        <CardBody className="flex flex-col items-center gap-3 py-10">
          {state === 'claiming' && (
            <>
              <Spinner size={28} />
              <p className="text-sm text-ink-500">Joining the circle…</p>
            </>
          )}
          {state === 'joined' && (
            <>
              <CheckCircle2 size={32} className="text-brand-600" />
              <p className="font-medium text-ink-900">You're in</p>
              <p className="text-sm text-ink-500">Taking you there…</p>
            </>
          )}
          {state === 'invalid' && (
            <>
              <XCircle size={32} className="text-ink-300" />
              <p className="font-medium text-ink-900">This invite link is no longer valid</p>
              <p className="text-sm text-ink-500">It may have already been used — ask for a fresh one.</p>
              <Link to="/circles">
                <Button size="sm" variant="outline" className="mt-2">
                  Go to your circles
                </Button>
              </Link>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
