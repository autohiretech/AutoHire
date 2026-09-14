import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';

/**
 * AutoHire — turning an auth failure into a sentence a person can act on.
 *
 * Sign-up and sign-in are the two screens where a stranger meets this product,
 * and until now both of them printed whatever Supabase Auth said. `auth.tsx`
 * does `throw new Error(error.message)` on every path, so the form showed
 * "Invalid login credentials", "Unable to validate email address: invalid
 * format", "User already registered" — a database's words, in a database's
 * register, at the one moment someone has the least patience for them. None of
 * those sentences tells the person what to do next, which is the only thing
 * they want to know.
 *
 * This module is the single place that decision is made, so the sign-up screen,
 * the sign-in screen and anything later (password reset, re-send confirmation)
 * cannot drift into three different voices for the same failure.
 *
 * ## Why this matches on `code`, not on the message
 *
 * Every branch below keys off `AuthError.code` — and, where there is no code,
 * off the error's class (`name`) or HTTP `status`. It deliberately does NOT
 * read the English message first.
 *
 * `code` is a contract: GoTrue publishes a fixed set of codes, auth-js mirrors
 * them in its exported `ErrorCode` union, and the server and SDK are versioned
 * against each other. The message beside it is not a contract — it is prose,
 * changed freely between releases, reworded for clarity, and localised at the
 * server's discretion. Matching prose gives you a mapping that passes today and
 * silently falls through to the generic sentence after a routine Supabase
 * upgrade, with no test failing and no error logged: the screen just gets worse
 * one day and nobody knows why. Codes fail loudly or not at all.
 *
 * There *is* a message-text layer at the bottom of this file, and the comment
 * on it explains the specific hole it plugs. It is a last resort, not the plan.
 *
 * ## A trap this module cannot cover, for whoever builds the sign-up form
 *
 * "That email already has an account" is surfaced here, at submit, and nowhere
 * else — no as-you-type lookup. That is the user's explicit call, and it is
 * also the safe one: a live "is this taken?" check turns the sign-up form into
 * a free tool for discovering who has an account here.
 *
 * But be aware that a duplicate sign-up does not always arrive as an error at
 * all. When a project has email confirmation switched on, GoTrue answers
 * `signUp` for an address that already exists with **success** and an
 * obfuscated user — deliberately, so the form cannot be used to enumerate
 * accounts. `authErrorMessage` never sees that case, because there is no error
 * to map: the correct handling is the one the screen already has for a new
 * unconfirmed account ("check your email"), which is exactly the point of the
 * obfuscation. (This is GoTrue server behaviour; it is not visible anywhere in
 * the installed SDK, so treat the detail as something to confirm against the
 * project's own auth settings rather than as fact from this comment.)
 */

/**
 * What went wrong, in AutoHire's terms rather than the provider's.
 *
 * A screen that wants only the sentence should call `authErrorMessage`. This
 * exists so a form can also decide *where* the sentence goes and whether to
 * offer a way out — the sign-up form puts the taken-email sentence beside the
 * email field with a "sign in" link, and putting that logic in the form means
 * re-deriving it from the sentence text.
 */
export type AuthFailureKind =
  | 'email_taken'
  | 'wrong_credentials'
  | 'no_such_account'
  | 'email_unconfirmed'
  | 'weak_password'
  | 'same_password'
  | 'invalid_email'
  | 'missing_fields'
  | 'rate_limited'
  | 'expired_code'
  | 'captcha_failed'
  | 'signup_unavailable'
  | 'account_unavailable'
  | 'signed_out'
  | 'unreachable'
  | 'unknown';

export interface AuthFailure {
  kind: AuthFailureKind;
  /** The sentence to show. Always present, always safe to render. */
  message: string;
  /** Which field the sentence belongs beside, when it belongs to one. */
  field: 'email' | 'password' | null;
  /** True when signing in to an existing account is the way out of this. */
  offerSignIn: boolean;
}

/**
 * The one sentence shown when nothing else matched.
 *
 * It says nothing about the provider on purpose. An unrecognised failure is by
 * definition one nobody has read, and pasting its text through to the screen is
 * how internal detail — a hook name, a row id, a stack frame, the name of a
 * service the user has no relationship with — ends up in front of a customer.
 * Generic and useless beats specific and leaking.
 */
const GENERIC = 'That did not go through. Try again in a moment.';

/**
 * Map a Supabase Auth failure to a sentence a person can act on.
 *
 * Takes `unknown` because every caller has a `catch` value, which TypeScript
 * types as `unknown` and which in this app is frequently *not* an `AuthError`:
 * `auth.tsx` re-throws `new Error(error.message)`, so a plain `Error` is the
 * common case today. Always returns a string — a screen rendering an error has
 * no sensible fallback of its own, so this function never returns empty and
 * never throws.
 */
export function authErrorMessage(err: unknown): string {
  return describeAuthError(err).message;
}

/** `authErrorMessage` plus the placement a form needs. See `AuthFailure`. */
export function describeAuthError(err: unknown): AuthFailure {
  // Weak passwords first, and by class rather than by code. The SDK raises
  // `AuthWeakPasswordError` both for the modern `weak_password` code and for
  // older servers that sent only a `weak_password.reasons` array with no code
  // at all, so the class is the wider net — and it is the only shape that
  // carries `reasons`, which is what lets the sentence say which rule was
  // missed instead of guessing at a character count this module does not know.
  if (isAuthWeakPasswordError(err)) {
    return weakPassword(err.reasons);
  }

  // Could not reach the server: `AuthRetryableFetchError` is raised both when
  // fetch itself rejected (status 0 — offline, DNS, blocked) and when the
  // response was a 5xx or a Cloudflare 52x. Those are two different sentences
  // because they are two different actions: check your connection, versus wait.
  if (isAuthRetryableFetchError(err)) {
    return unreachable(err.status ?? 0);
  }

  if (isAuthError(err)) {
    // `AuthInvalidCredentialsError` is thrown by the client before any request
    // when the call had no email/phone or no password — an empty form getting
    // past the UI's own validation. It carries no `code` (the server never saw
    // it), so the class name is the only stable handle; auth-js treats these
    // names as public API, exporting a type guard for most of them.
    if (err.name === 'AuthInvalidCredentialsError') {
      return {
        kind: 'missing_fields',
        message: 'Enter your email and password to continue.',
        field: null,
        offerSignIn: false,
      };
    }
    if (err.name === 'AuthSessionMissingError') {
      return signedOut();
    }

    const byCode = fromCode(err.code);
    if (byCode) return byCode;

    // No code, or a code newer than this SDK knows. `status` is still a real
    // contract even when the code is not: 429 is always a rate limit and 5xx is
    // always ours, whatever the body says.
    if (err.status === 429) return rateLimited(false);
    if (err.status !== undefined && err.status >= 500) return unreachable(err.status);

    return fromMessage(err.message) ?? unknown();
  }

  // A bare fetch rejection that never reached auth-js — the browser's own
  // "Failed to fetch" / "NetworkError", which is what an offline sign-in
  // attempt looks like if it fails outside the SDK's retry wrapper.
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return unreachable(0);
  }

  // The case this app actually produces most often: `auth.tsx` catches the
  // AuthError and re-throws `new Error(error.message)`, so the code, the status
  // and the class are all gone by the time a screen sees it, and the message is
  // the only evidence left. See `fromMessage`.
  if (err instanceof Error) {
    return fromMessage(err.message) ?? unknown();
  }

  return unknown();
}

/**
 * Codes confirmed against the `ErrorCode` union in the installed
 * @supabase/auth-js (2.108.2), `src/lib/error-codes.ts`. Anything not in that
 * union is not matched here — an invented code is a branch that can never run,
 * which is worse than no branch because it reads as covered.
 */
function fromCode(code: string | undefined): AuthFailure | null {
  switch (code) {
    // `user_already_exists` comes back from sign-up on a project with email
    // confirmation off; `email_exists` from the admin/update paths. Same fact
    // for the person either way.
    case 'user_already_exists':
    case 'email_exists':
      return {
        kind: 'email_taken',
        message: 'That email already has an account — sign in instead, or use a different address.',
        field: 'email',
        offerSignIn: true,
      };

    // Deliberately does not say which half was wrong. The server does not tell
    // us, and if it did, saying so would confirm to anyone typing that an
    // account exists for that address.
    case 'invalid_credentials':
      return {
        kind: 'wrong_credentials',
        message:
          'That email and password do not match an account. Check them and try again, or reset your password.',
        field: 'password',
        offerSignIn: false,
      };

    case 'user_not_found':
    case 'identity_not_found':
      return {
        kind: 'no_such_account',
        message: 'We could not find an account for that email. Check the address, or create an account.',
        field: 'email',
        offerSignIn: false,
      };

    case 'email_not_confirmed':
    case 'provider_email_needs_verification':
      return {
        kind: 'email_unconfirmed',
        message:
          'This email has not been confirmed yet. Open the link in the message we sent, then sign in.',
        field: 'email',
        offerSignIn: false,
      };

    // Reachable when the server sent the code but auth-js did not route it to
    // `AuthWeakPasswordError` — for instance after the message has already been
    // re-thrown as a plain Error and rebuilt elsewhere. No `reasons` here, so
    // the sentence stays general rather than inventing a rule.
    case 'weak_password':
      return weakPassword([]);

    case 'same_password':
      return {
        kind: 'same_password',
        message: 'That is the password you already have. Choose a different one.',
        field: 'password',
        offerSignIn: false,
      };

    case 'email_address_invalid':
    case 'email_address_not_authorized':
      return {
        kind: 'invalid_email',
        message: 'That does not look like an email address. Check it and try again.',
        field: 'email',
        offerSignIn: false,
      };

    // The catch-all the server uses when a field failed its own validation. On
    // these two screens the field in question is almost always the email, and
    // pointing at it is more use than a generic sentence; the wording holds up
    // even when it is something else, because "check what you typed" is the
    // action either way.
    case 'validation_failed':
      return {
        kind: 'invalid_email',
        message: 'Some of these details are not quite right. Check the email address and try again.',
        field: 'email',
        offerSignIn: false,
      };

    // Two different waits. A request-rate limit clears in seconds; an email or
    // SMS send limit is per address and clears in minutes, and the action is to
    // ask for the message again rather than to retry the form.
    case 'over_request_rate_limit':
      return rateLimited(false);
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return rateLimited(true);

    case 'otp_expired':
    case 'flow_state_expired':
      return {
        kind: 'expired_code',
        message: 'That link has expired. Ask for a new one and use it within the hour.',
        field: null,
        offerSignIn: false,
      };

    case 'captcha_failed':
      return {
        kind: 'captcha_failed',
        message: 'The security check did not pass. Try again.',
        field: null,
        offerSignIn: false,
      };

    // Configuration, not the person. Never hint at what an operator should go
    // and switch on — that sentence belongs in a log, not on a sign-up form.
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
      return {
        kind: 'signup_unavailable',
        message: 'New accounts are not open at the moment. Try again later, or get in touch and we will help.',
        field: null,
        offerSignIn: false,
      };

    case 'user_banned':
    case 'user_sso_managed':
      return {
        kind: 'account_unavailable',
        message: 'This account cannot be used to sign in. Get in touch and we will look into it.',
        field: null,
        offerSignIn: false,
      };

    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
      return signedOut();

    case 'request_timeout':
      return unreachable(504);

    default:
      return null;
  }
}

/**
 * Last resort: the English message.
 *
 * This exists for one concrete reason. `auth.tsx` unwraps every AuthError into
 * `new Error(error.message)` before a screen ever sees it, which throws away
 * the code, the status and the class and leaves the prose as the only evidence
 * of what happened. Without this layer, every sign-in failure in the app as it
 * stands today would show the generic sentence.
 *
 * These patterns are what GoTrue emits at the time of writing. They are NOT
 * confirmed by anything in the SDK — the SDK ships the codes, not the prose —
 * and they are expected to rot. That is survivable precisely because this runs
 * last: when a string changes, a branch stops matching and the person gets the
 * generic sentence, which is the same place they would have been without this
 * function at all. Nothing regresses below the baseline.
 *
 * The real fix is upstream — hand this module the AuthError itself rather than
 * its message — and then this layer only ever catches the stragglers.
 */
function fromMessage(message: string): AuthFailure | null {
  const m = message.toLowerCase();

  if (/already registered|already exists|already been registered/.test(m)) {
    return fromCode('user_already_exists');
  }
  if (/invalid login credentials|invalid email or password/.test(m)) {
    return fromCode('invalid_credentials');
  }
  if (/email not confirmed|not confirmed/.test(m)) {
    return fromCode('email_not_confirmed');
  }
  // "Password should be at least 6 characters" and friends.
  if (/password.*(at least|too short|too weak|should be)|weak password/.test(m)) {
    return weakPassword(['length']);
  }
  if (/unable to validate email address|invalid format|invalid email/.test(m)) {
    return fromCode('email_address_invalid');
  }
  // "For security purposes, you can only request this after 51 seconds."
  if (/rate limit|too many requests|for security purposes.*after/.test(m)) {
    return rateLimited(/email|sms/.test(m));
  }
  if (/failed to fetch|networkerror|network request failed|load failed/.test(m)) {
    return unreachable(0);
  }
  return null;
}

/**
 * `reasons` comes straight off `AuthWeakPasswordError` — GoTrue's own list,
 * typed in the SDK as 'length' | 'characters' | 'pwned'.
 *
 * The sentence never names a minimum length. The minimum is a per-project auth
 * setting this module cannot read, and a form that promises "at least 8" while
 * the project is set to 10 sends people round the same loop twice.
 */
function weakPassword(reasons: readonly string[]): AuthFailure {
  const has = (r: string) => reasons.includes(r);

  // A breached password is the one case where a longer password is not the
  // answer, so it wins over the others.
  const message = has('pwned')
    ? 'That password has appeared in a public data breach. Choose a different one.'
    : has('length') && !has('characters')
      ? 'That password is too short. Choose a longer one.'
      : has('characters') && !has('length')
        ? 'That password needs more variety. Mix in numbers or symbols.'
        : 'That password is too easy to guess. Choose a longer one, with numbers or symbols mixed in.';

  return { kind: 'weak_password', message, field: 'password', offerSignIn: false };
}

function rateLimited(perAddress: boolean): AuthFailure {
  return {
    kind: 'rate_limited',
    message: perAddress
      ? 'We have sent as many messages to that address as we can for now. Wait a few minutes, then ask for another.'
      : 'That is a few too many attempts in a row. Wait a minute, then try again.',
    field: null,
    offerSignIn: false,
  };
}

/**
 * `status` is 0 when fetch itself failed and 5xx when the server answered
 * badly. The distinction is the whole point: telling someone to check their
 * connection when the connection is fine sends them to reset a router over an
 * outage that is ours.
 */
function unreachable(status: number): AuthFailure {
  return {
    kind: 'unreachable',
    message:
      status >= 500
        ? 'AutoHire is having trouble at the moment. Wait a minute and try again.'
        : 'We could not reach AutoHire. Check your connection and try again.',
    field: null,
    offerSignIn: false,
  };
}

function signedOut(): AuthFailure {
  return {
    kind: 'signed_out',
    message: 'You have been signed out. Sign in again to pick up where you left off.',
    field: null,
    offerSignIn: true,
  };
}

function unknown(): AuthFailure {
  return { kind: 'unknown', message: GENERIC, field: null, offerSignIn: false };
}
