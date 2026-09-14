import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * Is this email / phone already on an account? Asked while the person types.
 *
 * The check cannot happen in the browser: `profiles` is RLS-protected, so an
 * anonymous page reads nothing from it — correctly. It goes to the
 * `check-account-availability` function, which holds the service-role key and
 * answers a boolean per field and nothing else. See that function's header for
 * what the endpoint costs and what keeps it narrow.
 *
 * **Every failure is silence, never a guess.** Not deployed, rate-limited,
 * offline, slow — all of them resolve to `'unknown'`, and the form says
 * nothing rather than claiming an address is free. The submit-time check
 * (`alreadyRegistered` / `email_taken`) is the backstop that always runs, so
 * "unknown" costs a person nothing except finding out one stage later.
 */
export type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'unknown';

interface AvailabilityAnswer {
  email: boolean | null;
  phone: boolean | null;
}

async function ask(input: { email?: string; phone?: string }): Promise<AvailabilityAnswer | null> {
  try {
    const { data, error } = await getSupabase().functions.invoke<AvailabilityAnswer>(
      'check-account-availability',
      { body: input },
    );
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/** How long to wait after the last keystroke before asking. */
const DEBOUNCE_MS = 500;

/**
 * Watch one field and report whether it is taken.
 *
 * `value` is what to ask about — already normalised by the caller (lowercased
 * email, E.164 phone) and empty when the field isn't worth asking about yet.
 * Passing an empty string is how a caller says "not valid yet, don't ask":
 * the endpoint is not a validator and should never see half-typed input.
 */
export function useAvailability(kind: 'email' | 'phone', value: string): Availability {
  const [state, setState] = useState<Availability>('idle');

  useEffect(() => {
    if (!value) {
      setState('idle');
      return;
    }
    setState('checking');
    // `cancelled` rather than an AbortController: the answer to an older
    // keystroke must not overwrite a newer one's, and invoke() has no abort.
    let cancelled = false;
    const timer = setTimeout(async () => {
      const answer = await ask({ [kind]: value });
      if (cancelled) return;
      const taken = answer?.[kind];
      setState(taken === true ? 'taken' : taken === false ? 'free' : 'unknown');
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, value]);

  return state;
}
