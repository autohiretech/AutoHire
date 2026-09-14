import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { setCurrentUserId } from '@/lib/identity';

/** Account kind chosen at signup. Personal = renter (can become an individual
 * host by listing a car); Company = a business / fleet host. */
export type AccountType = 'personal' | 'company';

/**
 * Ensure a `profiles` row exists for the logged-in user, shaped by the account
 * type chosen at signup (stored in auth user_metadata). Every auth user gets
 * exactly one profile keyed by their uid. Idempotent: inserts only when the row
 * is missing (`ignoreDuplicates`), so returning users keep any edits.
 */
async function ensureProfile(user: User): Promise<void> {
  const meta = (user.user_metadata ?? {}) as {
    account_type?: string;
    company_name?: string;
    full_name?: string;
    name?: string;
    phone?: string;
    wants_to_host?: boolean;
    country?: string;
    avatar_url?: string;
    picture?: string;
  };
  const accountType: AccountType = meta.account_type === 'company' ? 'company' : 'personal';
  const wantsToHost = meta.wants_to_host === true;
  const companyName = typeof meta.company_name === 'string' ? meta.company_name.trim() : '';
  const emailLocal = user.email?.split('@')[0] ?? 'New user';
  // Google sign-in puts the name in `full_name`/`name` and the photo in
  // `avatar_url`/`picture`.
  const metaName = meta.full_name?.trim() || meta.name?.trim() || '';
  const fullName = metaName || emailLocal;
  const phone =
    typeof meta.phone === 'string' && meta.phone.trim() ? meta.phone.trim() : user.phone ?? '';
  const avatarUrl = meta.avatar_url?.trim() || meta.picture?.trim() || undefined;

  // The account's country, chosen at sign-up. Payout routing reads this
  // column, and a host whose account country is wrong is put on the wrong
  // rail — which is why it is asked for before anything else rather than left
  // to be discovered on the payout screen. Omitted rather than defaulted when
  // absent (an account made before the field existed, or by a provider that
  // doesn't supply one), so nothing silently claims to be Rwandan.
  const country =
    typeof meta.country === 'string' && /^[A-Za-z]{2}$/.test(meta.country.trim())
      ? meta.country.trim().toUpperCase()
      : undefined;

  const base = {
    id: user.id,
    email: user.email ?? '',
    phone,
    joined_at: new Date().toISOString().slice(0, 10),
    ...(country ? { country } : {}),
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
  };

  const row: Record<string, unknown> =
    accountType === 'company'
      ? {
          ...base,
          full_name: fullName, // the contact / authorised representative
          role: 'owner',
          owner_type: 'business',
          business_name: companyName || fullName,
          payout_terms: 'net_30',
          insurance_type: 'commercial',
          vehicle_count: 0,
        }
      : wantsToHost
        ? {
            // Personal account that opted to host at signup — an individual host.
            ...base,
            full_name: fullName,
            role: 'owner',
            owner_type: 'individual',
            payout_terms: 'per_trip',
            insurance_type: 'platform_provided',
            vehicle_count: 0,
          }
        : {
            ...base,
            full_name: fullName,
            role: 'renter',
          };

  const { error } = await getSupabase()
    .from('profiles')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (!error) return;

  // `profiles_phone_unique` (migration 095) can refuse this row: the sign-up
  // form checks the number against the database, but two people can pass that
  // check in the same second, and an account created before the constraint
  // existed may already hold the number.
  //
  // The auth user exists by now either way, so failing here would leave
  // someone signed in with no profile at all — every screen that reads
  // `useCurrentUser` blank, and no way out of it. The number is the one field
  // that can be dropped and fixed later (Account → phone), so the row goes in
  // without it rather than not at all.
  if (error.code === '23505' && error.message.includes('profiles_phone_unique')) {
    console.warn('ensureProfile: phone already registered, creating the profile without it');
    const { error: retryError } = await getSupabase()
      .from('profiles')
      .upsert({ ...row, phone: '' }, { onConflict: 'id', ignoreDuplicates: true });
    if (retryError) console.error('ensureProfile retry failed', retryError);
    return;
  }
  console.error('ensureProfile failed', error);
}

interface SignUpDetails {
  accountType: AccountType;
  fullName: string;
  phone: string;
  /** ISO 3166-1 alpha-2. Required at sign-up — see `ensureProfile`. */
  country: string;
  companyName?: string;
  /** Personal accounts can opt to be a host from the start. */
  wantsToHost?: boolean;
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Start the Google OAuth flow — redirects out, then back into the app.
   *
   * Nothing calls this at the moment: the "Continue with Google" button was
   * taken off the sign-in screen (2026-09-14, the user's call — "remove google
   * for now"). The plumbing is deliberately left in place, because putting the
   * button back is then one JSX element rather than a re-implementation.
   */
  signInWithGoogle: () => Promise<void>;
  signUp: (
    email: string,
    password: string,
    details: SignUpDetails,
  ) => Promise<{ needsConfirmation: boolean; alreadyRegistered: boolean }>;
  signOut: () => Promise<void>;
  /** Permanently delete the account (login + all data) via the Edge Function. */
  deleteAccount: () => Promise<void>;
  /** Send an SMS code to verify (or change to) the given phone number. */
  sendPhoneOtp: (phone: string) => Promise<void>;
  /** Confirm the SMS code; on success the user's phone becomes verified. */
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>;
}

/** True when the error looks like "phone auth / SMS provider isn't set up". */
function isPhoneProviderError(message: string): boolean {
  return /provider|sms|phone.*(disabled|not|unsupported)|disabled/i.test(message);
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
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    // The AuthError itself, not a copy of its message: `code` and `status` are
    // what `describeAuthError` matches on, and `new Error(error.message)`
    // threw them away and left it matching English prose instead.
    if (error) throw error;
    // Adopt the session synchronously here (the same steps as the
    // onAuthStateChange handler) so a navigate() immediately after sign-in
    // doesn't race the async auth listener. Without this the user is still null
    // when the AppLayout guard renders, so the first click bounces back to
    // /login and only the second click gets through.
    if (data.user) {
      setCurrentUserId(data.user.id);
      await ensureProfile(data.user);
      setUser(data.user);
    }
  }

  async function signInWithGoogle() {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      // Supabase returns the session in the URL on this page; the JS client picks
      // it up automatically and `onAuthStateChange` signs the user in.
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      throw new Error(
        /provider|not enabled|unsupported|disabled/i.test(error.message)
          ? "Google sign-in isn't enabled yet — turn on the Google provider in Supabase (Authentication → Providers)."
          : error.message,
      );
    }
  }

  /**
   * Create an account.
   *
   * `alreadyRegistered` is the one answer that cannot be read from an error.
   * With email confirmation ON, GoTrue deliberately does NOT fail a sign-up
   * for an address that already exists — it returns success with an
   * obfuscated user whose `identities` array is empty, precisely so sign-up
   * cannot be used to enumerate accounts. With confirmation OFF it errors
   * instead. Both are real configurations of this project, so both are
   * reported, and the caller decides what to say.
   */
  async function signUp(email: string, password: string, details: SignUpDetails) {
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: {
        // Persisted as user_metadata; ensureProfile reads it to shape the profile.
        data: {
          account_type: details.accountType,
          full_name: details.fullName.trim(),
          phone: details.phone.trim(),
          country: details.country.trim().toUpperCase(),
          company_name: details.companyName?.trim() || undefined,
          wants_to_host: details.wantsToHost === true,
        },
      },
    });
    if (error) throw error;

    // Empty `identities` on an otherwise-successful sign-up means the address
    // is taken — see above. `identities` is optional on the type, so an
    // undefined array is NOT treated as taken.
    const alreadyRegistered = Boolean(data.user && data.user.identities?.length === 0);

    // When the account is auto-confirmed (no email step), adopt the session
    // synchronously so the navigate() after sign-up doesn't race the auth
    // listener and bounce off the AppLayout guard — same fix as signIn.
    if (data.session && data.user) {
      setCurrentUserId(data.user.id);
      await ensureProfile(data.user);
      setUser(data.user);
    }
    // No session means Supabase is set to require email confirmation.
    return { needsConfirmation: !data.session, alreadyRegistered };
  }

  async function signOut() {
    await getSupabase().auth.signOut();
  }

  async function deleteAccount() {
    const { error } = await getSupabase().functions.invoke('dynamic-endpoint');
    if (error) {
      // Couldn't reach the function at all (not deployed / blocked by CORS).
      if (error.name === 'FunctionsFetchError') {
        throw new Error(
          "Account deletion isn't set up yet. The account-deletion Edge Function " +
            "('dynamic-endpoint') needs to be deployed with Verify JWT turned OFF.",
        );
      }
      // The function ran but returned an error — surface its message (e.g. a
      // missing cascade migration shows up here as a delete failure).
      let detail = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = (await ctx.json()) as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          /* response had no JSON body — keep the generic message */
        }
      }
      throw new Error(detail);
    }
    await getSupabase().auth.signOut();
    setCurrentUserId(null);
    setUser(null);
  }

  async function sendPhoneOtp(phone: string) {
    // Setting the phone on the auth user triggers an SMS confirmation code.
    const { error } = await getSupabase().auth.updateUser({ phone });
    if (error) {
      throw new Error(
        isPhoneProviderError(error.message)
          ? "Phone verification isn't enabled yet — turn on Phone auth and connect an SMS provider (e.g. Twilio) in Supabase."
          : error.message,
      );
    }
  }

  async function verifyPhoneOtp(phone: string, token: string) {
    const { data, error } = await getSupabase().auth.verifyOtp({
      phone,
      token,
      type: 'phone_change',
    });
    if (error) throw error;
    if (data.user) setUser(data.user);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signInWithGoogle,
        signUp,
        signOut,
        deleteAccount,
        sendPhoneOtp,
        verifyPhoneOtp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
