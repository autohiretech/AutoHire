import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Check, ChevronRight, User } from 'lucide-react';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandMark } from '@/components/BrandMark';
import { useAuth, type AccountType } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { normalizePhone } from '@/lib/phone';
import { Button, Input, Label } from '@/components/ui';

type Mode = 'signin' | 'signup';

/**
 * Signing up is three stages, not one long form.
 *
 * The old screen asked for account type, host intent, name, email, phone,
 * password and the terms all at once — nine controls stacked past the bottom
 * of a phone, before the visitor had been told anything. Same fix, and the
 * same reasoning, as the six-stage listing flow in `ListCarPage`: ask one
 * thing at a time, say why it is wanted, and refuse to advance until the
 * stage is actually answered, so a mistake is caught on the screen that can
 * fix it rather than at the end.
 */
const STEPS = ['You', 'Details', 'Sign-in'];

/** One sentence per stage. The sentence is most of what makes a form feel easy. */
const STEP_BLURB = [
  'First, how will you use AutoHire? You can rent and host from the same account either way.',
  'Who are you? Your name goes on your bookings, and hosts see it when you ask for their car.',
  'Last one. This is what you will sign in with.',
];

/**
 * Sign in / sign up — the marketplace's front door, and also the admin site's
 * (`admin-main.tsx` renders this same component).
 *
 * `backdrop` is what separates the two: the marketplace gets the driving
 * footage behind the form, the admin tool does not. An admin signing in to
 * moderate listings is at work, not being sold a road trip — and the clip
 * lives in `public/`, which the admin build replaces with `public-admin/`,
 * so over there the file genuinely isn't there to load.
 *
 * `initialMode` is what `/signup` passes, so creating an account is a real URL
 * someone can be sent to rather than a toggle hidden inside `/login`.
 *
 * `allowSignup` is off for the admin site. Creating an account there produced
 * a marketplace account on an internal tool's origin, which `AdminGate` then
 * refused with "This account isn't an admin" — never a hole, but a door that
 * should not have been in the wall. Admins are made by admins, not by signing
 * up at the admin door.
 */
export function LoginPage({
  backdrop = true,
  initialMode = 'signin',
  allowSignup = true,
}: {
  backdrop?: boolean;
  initialMode?: Mode;
  allowSignup?: boolean;
}) {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<Mode>(allowSignup ? initialMode : 'signin');
  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [companyName, setCompanyName] = useState('');
  const [wantsToHost, setWantsToHost] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  /**
   * Which stage of the sign-up we are on, and which way we last moved. `dir`
   * is only for the animation: forward slides in from the right, Back from
   * the left, which is what makes the movement read as a place you are in
   * rather than a repaint.
   */
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const lastStep = step === STEPS.length;

  function goToStep(n: number) {
    setDir(n > step ? 'fwd' : 'back');
    setStep(n);
    setError(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStep(1);
    setDir('fwd');
    setError(null);
    setInfo(null);
  }

  /**
   * What this stage will not let past. Returns the sentence to show, or null
   * when the stage is answered — so one function serves as both "can I
   * continue?" and "why not?".
   */
  function blockerFor(n: number): string | null {
    if (n === 1) {
      if (accountType === 'company' && !companyName.trim()) return 'Please enter your company name.';
      return null;
    }
    if (n === 2) {
      if (!fullName.trim()) {
        return accountType === 'company'
          ? 'Please enter a contact name.'
          : 'Please enter your full name.';
      }
      if (!normalizePhone(phone)) {
        return 'Enter a valid phone number with country code, e.g. +250 788 123 456.';
      }
      return null;
    }
    if (!acceptedTerms) return 'Please accept the terms to continue.';
    return null;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    // Enter inside a field submits the form, so mid-sign-up that has to mean
    // "next stage", not "create the account with half the answers".
    if (mode === 'signup' && !lastStep) {
      const blocker = blockerFor(step);
      if (blocker) {
        setError(blocker);
        return;
      }
      goToStep(step + 1);
      return;
    }

    // Read credentials straight from the form so browser-autofilled values are
    // captured even when React's onChange hasn't fired yet. Without this the
    // first click submits empty credentials (which fails) and the user has to
    // click "Sign in" twice.
    const data = new FormData(e.currentTarget);
    const emailValue = ((data.get('email') as string | null) ?? email).trim();
    const passwordValue = (data.get('password') as string | null) ?? password;
    if (emailValue !== email) setEmail(emailValue);
    if (passwordValue !== password) setPassword(passwordValue);
    if (mode === 'signup') {
      const blocker = blockerFor(step);
      if (blocker) {
        setError(blocker);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(emailValue, passwordValue);
        navigate(from, { replace: true });
      } else {
        const { needsConfirmation } = await signUp(emailValue, passwordValue, {
          accountType,
          companyName,
          fullName,
          phone: normalizePhone(phone) ?? phone,
          wantsToHost: accountType === 'personal' && wantsToHost,
        });
        if (needsConfirmation) {
          setInfo('Check your email to confirm your account, then sign in.');
          switchMode('signin');
        } else if (accountType === 'company' || wantsToHost) {
          // Hosts (companies, or personal accounts that opted to host) land on
          // the dashboard — their Hosting experience.
          navigate('/dashboard', { replace: true });
        } else {
          navigate(from, { replace: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full w-full flex-col justify-center px-4 py-10 sm:py-14">
      {backdrop && <AuthBackdrop />}

      <div
        className={cn(
          'mx-auto w-full',
          // Two columns only once there is room for both: the line on the left
          // is the reason the panel is allowed to sit off-centre over the
          // footage, and below `lg` there is no left for it to sit beside.
          backdrop && 'lg:grid lg:max-w-6xl lg:grid-cols-2 lg:items-center lg:gap-16',
        )}
      >
        {backdrop && (
          <div className="hidden lg:block">
            <h2 className="text-display text-[var(--color-content)]">
              Rent or host self-drive cars.
            </h2>
            <p className="mt-3 max-w-sm text-body-lg text-[var(--color-content-muted)]">
              One account does both — rent from someone near you, and list your own car whenever you
              want to.
            </p>
          </div>
        )}

        {/* Everything a visitor has to read sits inside this panel, so nothing
            is ever set directly on moving footage. */}
        <section className={cn('w-full max-w-[27rem]', backdrop ? 'mx-auto lg:mx-0' : 'mx-auto')}>
          <div
            className={cn(
              'flex flex-col',
              backdrop &&
                'rounded-[var(--radius-sheet)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]/95 p-6 shadow-[var(--shadow-float)] backdrop-blur sm:p-9',
            )}
          >
            <Link
              to="/"
              className="flex items-center justify-center gap-2 font-semibold text-[var(--color-content)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
                <BrandMark size={20} />
              </span>
              <span className="text-body-lg">AutoHire</span>
            </Link>

            <h1 className="mt-7 text-center text-h2 text-[var(--color-content)]">
              {mode === 'signin' ? 'Sign in' : 'Create your account'}
            </h1>
            <p className="mt-2 text-center text-body-sm text-[var(--color-content-muted)]">
              {mode === 'signin' ? 'Welcome back to AutoHire.' : STEP_BLURB[step - 1]}
            </p>

            {mode === 'signup' && (
              /* The map of the job, before the job. Three named stages with
                 the current one marked say in one glance how long this is.
                 A finished stage is clickable; a later one is not — forward
                 is earned by answering the stage you are on. */
              <ol className="mt-6 flex items-center justify-center gap-1.5">
                {STEPS.map((label, i) => {
                  const n = i + 1;
                  const done = n < step;
                  const here = n === step;
                  return (
                    <li key={label} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={n > step}
                        onClick={() => goToStep(n)}
                        className={cn(
                          'flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] px-2.5 py-1 text-caption font-medium transition-colors',
                          here && 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]',
                          done && 'text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]',
                          !here && !done && 'text-[var(--color-content-subtle)]',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]',
                            here
                              ? 'bg-[var(--color-accent-contrast)]/25'
                              : done
                                ? 'bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]'
                                : 'bg-[var(--color-surface-sunken)]',
                          )}
                        >
                          {done ? <Check size={10} /> : n}
                        </span>
                        {/* Below ~380px the three labelled pills no longer fit
                            the panel, and the numbers say the same thing. */}
                        <span className="hidden min-[380px]:inline">{label}</span>
                      </button>
                      {n < STEPS.length && (
                        <ChevronRight size={12} className="text-[var(--color-content-subtle)]" />
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {/* `scroll-mb-32` on every field is what keeps the phone keyboard
                off the thing you are typing into. When a field is focused the
                browser scrolls it just barely into view, which on a phone means
                flush against the top of the keyboard — measured at 390×420
                (keyboard up) the phone field's bottom border sat exactly on the
                fold and Continue was 100px under it, so submitting meant
                dismissing the keyboard first. Scroll-margin makes that
                scroll-into-view stop short, bringing the button up with it.
                One rule on the form rather than five on the fields, so a field
                added later is covered too. */}
            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-5 [&_input]:scroll-mb-32">
              {/* `key` is what replays the animation: React tears the old
                  stage down and mounts the new one, so the CSS runs again. */}
              <div
                key={mode === 'signup' ? step : 'signin'}
                className={cn(
                  'flex flex-col gap-5',
                  mode === 'signup' && (dir === 'fwd' ? 'animate-step-in' : 'animate-step-back'),
                )}
              >
                {mode === 'signup' && step === 1 && (
                  <>
                    <div>
                      <Label>Account type</Label>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        {(
                          [
                            {
                              value: 'personal',
                              label: 'Personal',
                              hint: 'Rent · or list your own car',
                              icon: User,
                            },
                            {
                              value: 'company',
                              label: 'Company',
                              hint: 'Fleet / business host',
                              icon: Building2,
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setAccountType(opt.value)}
                            className={cn(
                              'flex flex-col items-start gap-1 rounded-[var(--radius-control)] border p-3 text-left transition-colors',
                              accountType === opt.value
                                ? 'border-[var(--color-accent-on)] bg-[var(--color-surface-sunken)]'
                                : 'border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]',
                            )}
                          >
                            <span className="flex items-center gap-1.5 text-body-sm font-medium text-[var(--color-content)]">
                              <opt.icon size={15} /> {opt.label}
                            </span>
                            <span className="text-caption text-[var(--color-content-muted)]">
                              {opt.hint}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {accountType === 'personal' && (
                      <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--color-line-strong)] p-3 text-body-sm text-[var(--color-content-muted)]">
                        <input
                          type="checkbox"
                          checked={wantsToHost}
                          onChange={(e) => setWantsToHost(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-accent-on)] focus:ring-[var(--color-accent-on)]"
                        />
                        <span>
                          <span className="font-medium text-[var(--color-content)]">
                            I want to rent out my vehicle or machine
                          </span>{' '}
                          — start as a host. You can switch between hosting and renting anytime from
                          your profile.
                        </span>
                      </label>
                    )}

                    {accountType === 'company' && (
                      <div>
                        <Label htmlFor="company">Company name</Label>
                        <Input
                          id="company"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="Kigali Car Rental Self Drive"
                        />
                      </div>
                    )}
                  </>
                )}

                {mode === 'signup' && step === 2 && (
                  <>
                    <div>
                      <Label htmlFor="fullName">
                        {accountType === 'company' ? 'Contact name' : 'Full name'}
                      </Label>
                      <Input
                        id="fullName"
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="As shown on your ID"
                      />
                    </div>

                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+250 788 123 456"
                      />
                      <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                        Include your country code (e.g. +250 Rwanda, +1 US). Local 07… numbers also
                        work.
                      </p>
                    </div>
                  </>
                )}

                {(mode === 'signin' || step === 3) && (
                  <>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                      />
                      {mode === 'signup' && (
                        <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                          At least 6 characters.
                        </p>
                      )}
                    </div>

                    {mode === 'signup' && (
                      <label className="flex items-start gap-2 text-body-sm text-[var(--color-content-muted)]">
                        <input
                          type="checkbox"
                          checked={acceptedTerms}
                          onChange={(e) => setAcceptedTerms(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-accent-on)] focus:ring-[var(--color-accent-on)]"
                        />
                        <span>I agree to AutoHire's terms of service and privacy policy.</span>
                      </label>
                    )}
                  </>
                )}
              </div>

              {error && <p className="text-body-sm text-[var(--color-danger-500)]">{error}</p>}
              {info && <p className="text-body-sm text-brand-700 dark:text-brand-300">{info}</p>}

              {/* The one primary action on this screen, and — while signing up
                  — the way back to the stage before it. */}
              <div className="flex flex-col gap-2">
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy
                    ? 'Please wait…'
                    : mode === 'signin'
                      ? 'Sign in'
                      : lastStep
                        ? 'Create account'
                        : 'Continue'}
                </Button>

                {mode === 'signup' && step > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => goToStep(step - 1)}
                    disabled={busy}
                  >
                    <ArrowLeft size={16} /> Back
                  </Button>
                )}
              </div>
            </form>

            {allowSignup && (
              <p className="mt-6 text-center text-body-sm text-[var(--color-content-muted)]">
                {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <button
                  type="button"
                  onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                  className="font-medium text-[var(--color-accent-on)] hover:underline"
                >
                  {mode === 'signin' ? 'Sign up' : 'Sign in'}
                </button>
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
