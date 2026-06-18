import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { setCurrentUserId } from '@/lib/identity';

/**
 * Ensure a `profiles` row exists for the logged-in user. Under the
 * "fresh signups start empty" model every auth user gets their own profile
 * (keyed by the auth uid) and starts with no listings/bookings of their own.
 * Idempotent: inserts only when the row is missing, so returning users keep
 * any edits they've made.
 */
async function ensureProfile(user: User): Promise<void> {
  const fallbackName = user.email?.split('@')[0] ?? 'New user';
  await getSupabase()
    .from('profiles')
    .upsert(
      {
        id: user.id,
        full_name: fallbackName,
        email: user.email ?? '',
        phone: user.phone ?? '',
        role: 'renter',
        joined_at: new Date().toISOString().slice(0, 10),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Supabase Auth session provider. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();

    async function adopt(nextUser: User | null) {
      setCurrentUserId(nextUser?.id ?? null);
      if (nextUser) await ensureProfile(nextUser);
      setUser(nextUser);
    }

    sb.auth.getSession().then(async ({ data }) => {
      await adopt(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      void adopt(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async function signUp(email: string, password: string) {
    const { data, error } = await getSupabase().auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    // No session means Supabase is set to require email confirmation.
    return { needsConfirmation: !data.session };
  }

  async function signOut() {
    await getSupabase().auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
