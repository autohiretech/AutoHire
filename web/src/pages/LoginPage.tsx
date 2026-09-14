import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Check, ChevronRight, Pencil, User } from 'lucide-react';
import { AuthBackdrop } from '@/components/AuthBackdrop';
import { BrandMark } from '@/components/BrandMark';
import { CountryCombobox } from '@/components/CountryCombobox';
import { useAuth, type AccountType } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';
import { countryOfTyped, dialCodeFor, normalizePhone, phoneProblem } from '@/lib/phone';
import { useAvailability, type Availability } from '@/lib/accountAvailability';
import { describeAuthError } from '@/lib/authErrors';
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
 *
 * The two account facts come first: the country, because payout routing and
 * the phone's own dialling code both read it, and the email, because it is
 * the account's identity. The password waits until the end, where it belongs
 * with the terms it is agreed alongside.
 */
const STEPS = ['You', 'Details', 'Password'];

/** One sentence per stage. The sentence is most of what makes a form feel easy. */
const STEP_BLURB = [
  'Where your account lives, and how we reach you.',
  'Your name goes on your bookings; hosts see it when you ask for their car.',
  'Last one — a password, and the terms.',
];

/**
 * The live answer under a field, in one line.
 *
 * `'unknown'` renders nothing on purpose: the endpoint may be undeployed,
 * rate-limited or unreachable, and a form that cannot check must say nothing
 * rather than imply an address is free. `'checking'` is also silent — a
 * flicker of "checking…" on every keystroke is noise, and the answer arrives
 * in half a second.
 */
function FieldStatus({
  state,
  taken,
  free,
}: {
  state: Availability;
  taken: ReactNode;
  free: ReactNode;
}) {
  if (state === 'taken') {
    return <p className="mt-1 text-caption text-[var(--color-danger-500)]">{taken}</p>;
  }
  if (state === 'free') {
    return <p className="mt-1 text-caption text-[var(--color-content-subtle)]">{free}</p>;
  }
  return null;
}

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
  // The markets AutoHire actually serves, from PayHold's `payment-options` —
  // never a list written here. `countries` is the same source the header's
  // market selector and the Account page's country field read.
  const { countries, country: browsingCountry } = useCountry();
  /**
   * Starts on the market they are already browsing rather than blank.
   *
   * An open search box with a country list under it is the single tallest
   * thing on this stage, and it pushed Continue off the bottom of every phone
   * — so the answer is shown, not asked for, and changing it is one tap. The
   * default is not a guess about the person: it is the market the catalogue
   * is already filtered to, which is the same value the header's selector and
   * the saved preference drive.
   */
  const [country, setCountry] = useState(browsingCountry.code);
  const [pickingCountry, setPickingCountry] = useState(false);
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

  const chosenCountry = useMemo(
    () => countries.find((c) => c.code === country) ?? null,
    [countries, country],
  );
  /**
   * The phone prefix, from the country they just picked — libphonenumber's
   * own calling code, so it cannot disagree with the rules the number is
   * then validated against. Null for a country the metadata doesn't know, and
   * then the field asks for a full international number instead.
   */
  const dialCode = dialCodeFor(country);

  /**
   * When the number carries its own country code, that is the country it will
   * be saved under — so it is the one the field shows. Selecting Burundi and
   * typing +250 799 494 538 is a valid Rwandan number, and the old chip sat
   * there reading "+257" next to it.
   */
  const typed = countryOfTyped(phone);
  const shownDial = typed?.dialCode ?? dialCode;
  const shownFlag = typed
    ? (countries.find((c) => c.code === typed.country)?.flag ?? '🌍')
    : chosenCountry?.flag;

  /**
   * Asked while they type, not at the end. Both only ask once the value is
   * worth asking about — a valid address, a number that parses — so the
   * endpoint never sees half-typed input.
   */
  const emailAvailability = useAvailability(
    'email',
    mode === 'signup' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
      ? email.trim().toLowerCase()
      : '',
  );
  const phoneAvailability = useAvailability(
    'phone',
    mode === 'signup' ? (normalizePhone(phone, country) ?? '') : '',
  );

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
      // The country is a button, not an input, so the browser's own required
      // check never sees it — this is the only thing standing in for it.
      if (!country) return 'Please choose the country your account is in.';
      if (emailAvailability === 'taken') {
        return 'That email already has an AutoHire account — sign in instead.';
      }
      if (accountType === 'company' && !companyName.trim()) return 'Please enter your company name.';
      return null;
    }
    if (n === 2) {
      if (!fullName.trim()) {
        return accountType === 'company'
          ? 'Please enter a contact name.'
          : 'Please enter your full name.';
      }
      // Judged by the country's own numbering rules, not by length alone.
      const problem = phoneProblem(phone, country, chosenCountry?.name);
      if (problem) return problem;
      if (phoneAvailability === 'taken') {
        return 'That phone number is already on an AutoHire account.';
      }
      return null;
    }
    if (!acceptedTerms) return 'Please accept the terms to continue.';
    return null;
  }

  /**
   * Copy whatever the browser autofilled into React's state.
   *
   * Autofill can set a field's value without firing `onChange`, which used to
   * mean the first click submitted an empty email. Reading the form on submit
   * fixed that — but email and password now live on different stages, so only
   * the mounted one can be read, and it has to be read on the stage it is on
   * rather than at the end. Hence a sync on every submit, whichever stage.
   */
  function syncAutofill(form: HTMLFormElement) {
    const data = new FormData(form);
    const emailValue = (data.get('email') as string | null)?.trim();
    const passwordValue = data.get('password') as string | null;
    if (emailValue && emailValue !== email) setEmail(emailValue);
    if (passwordValue && passwordValue !== password) setPassword(passwordValue);
    return {
      email: emailValue || email,
      password: passwordValue || password,
    };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const filled = syncAutofill(e.currentTarget);

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

    const emailValue = filled.email.trim();
    const passwordValue = filled.password;
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
        const { needsConfirmation, alreadyRegistered } = await signUp(
          emailValue,
          passwordValue,
          {
            accountType,
            companyName,
            country,
            fullName,
            phone: normalizePhone(phone, country) ?? phone,
            wantsToHost: accountType === 'personal' && wantsToHost,
          },
        );
        // A sign-up that "succeeded" for an address that already has an
        // account — the obfuscated answer GoTrue gives when confirmation is
        // on. Nothing was created, so saying "check your email" would be a
        // lie they would wait on.
        if (alreadyRegistered) {
          switchMode('signin');
          setInfo('That email already has an AutoHire account — sign in below.');
        } else if (needsConfirmation) {
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
      // Never the provider's own words. `describeAuthError` turns the auth
      // service's error into one sentence a person can act on, matched on the
      // error's `code` rather than its English text.
      const failure = describeAuthError(err);
      // "You already have an account" is the one failure with somewhere to
      // send them, so it moves them there with the address they just typed
      // rather than restating the refusal.
      if (mode === 'signup' && failure.kind === 'email_taken') {
        switchMode('signin');
        setInfo(failure.message);
      } else {
        setError(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full w-full flex-col justify-center px-4 py-6 [@media(max-height:680px)]:py-3 sm:py-14">
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
                'rounded-[var(--radius-sheet)] border border-[var(--color-line)] bg-[var(--color-surface-raised)]/95 p-5 shadow-[var(--shadow-float)] backdrop-blur [@media(max-height:680px)]:p-4 sm:p-9',
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

            <h1 className="mt-4 text-center text-h3 text-[var(--color-content)] sm:mt-7 sm:text-h2">
              {mode === 'signin' ? 'Sign in' : 'Create your account'}
            </h1>
            {/* On a short screen the stage sentence is the first thing to
                go: the heading and the stepper already say where you are, and
                a line of prose is not worth the primary action falling below
                the fold. */}
            <p className="mt-2 text-center text-body-sm text-[var(--color-content-muted)] [@media(max-height:680px)]:hidden">
              {mode === 'signin' ? 'Welcome back to AutoHire.' : STEP_BLURB[step - 1]}
            </p>

            {mode === 'signup' && (
              /* The map of the job, before the job. Three named stages with
                 the current one marked say in one glance how long this is.
                 A finished stage is clickable; a later one is not — forward
                 is earned by answering the stage you are on. */
              <ol className="mt-4 flex items-center justify-center gap-1.5 sm:mt-6">
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
            <form
              onSubmit={onSubmit}
              className="mt-4 flex flex-col gap-4 [&_input]:scroll-mb-32 [@media(max-height:680px)]:gap-3 sm:mt-7 sm:gap-5"
            >
              {/* `key` is what replays the animation: React tears the old
                  stage down and mounts the new one, so the CSS runs again. */}
              <div
                key={mode === 'signup' ? step : 'signin'}
                className={cn(
                  'flex flex-col gap-4 [@media(max-height:680px)]:gap-3 sm:gap-5',
                  mode === 'signup' && (dir === 'fwd' ? 'animate-step-in' : 'animate-step-back'),
                )}
              >
                {mode === 'signup' && step === 1 && (
                  <>
                    <div>
                      <Label>Your country</Label>
                      {/* The list is PayHold's answer to "where can AutoHire
                          take and send money", not a constant — so a market
                          opening or closing changes this field with no edit
                          here. Shown open until it is answered, because it is
                          the first thing asked and an unanswered question
                          should look like one. */}
                      {/* The search floats over the panel instead of growing
                          it. In flow it added 128px the instant it opened —
                          the panel jumped and the page started scrolling on
                          the very first interaction of the flow, then shrank
                          back when a country was chosen. As a popover the
                          panel's height never changes at all.

                          `CountryCombobox`'s own default is deliberately the
                          opposite (in flow, because it is used inside a
                          scrolling modal where an absolute list is clipped at
                          the modal's edge). This panel is not a scroll
                          container, so here the overlay is free. */}
                      <div className="relative mt-1.5">
                        <button
                          type="button"
                          onClick={() => setPickingCountry((v) => !v)}
                          aria-expanded={pickingCountry}
                          className="flex h-11 w-full items-center justify-between rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 text-body-sm text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]"
                        >
                          <span>
                            {chosenCountry ? (
                              <>
                                {chosenCountry.flag} {chosenCountry.name}
                              </>
                            ) : (
                              <span className="text-[var(--color-content-subtle)]">
                                Choose your country
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1 text-caption text-[var(--color-content-muted)]">
                            <Pencil size={13} /> Change
                          </span>
                        </button>

                        {pickingCountry && (
                          <>
                            {/* A click anywhere else closes it, including on
                                the fields underneath, which would otherwise
                                be picking up taps meant to dismiss. */}
                            <div
                              className="fixed inset-0 z-30"
                              aria-hidden
                              onClick={() => setPickingCountry(false)}
                            />
                            <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-overlay)] p-2 shadow-[var(--shadow-float)]">
                              <CountryCombobox
                                countries={countries}
                                autoFocus
                                placeholder="Search countries…"
                                onSelect={(code) => {
                                  setCountry(code);
                                  setPickingCountry(false);
                                  setError(null);
                                }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                        Sets your payout options and phone code. You can rent anywhere.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        aria-invalid={emailAvailability === 'taken'}
                        required
                      />
                      <FieldStatus
                        state={emailAvailability}
                        taken={
                          <>
                            Already registered.{' '}
                            <button
                              type="button"
                              onClick={() => switchMode('signin')}
                              className="font-medium text-[var(--color-accent-on)] hover:underline"
                            >
                              Sign in instead
                            </button>
                          </>
                        }
                        free="Looks free."
                      />
                    </div>

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
                              'flex flex-col items-start gap-0.5 rounded-[var(--radius-control)] border p-2.5 text-left transition-colors sm:gap-1 sm:p-3',
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
                      <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--color-line-strong)] p-2.5 text-body-sm text-[var(--color-content-muted)] sm:p-3">
                        <input
                          type="checkbox"
                          checked={wantsToHost}
                          onChange={(e) => setWantsToHost(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-accent-on)] focus:ring-[var(--color-accent-on)]"
                        />
                        <span>
                          <span className="font-medium text-[var(--color-content)]">
                            I want to rent out my vehicle or machine
                          </span>
                          <br />
                          Start as a host — switch anytime.
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
                      {/* The country code is shown, not typed. It comes from
                          the country chosen on the stage before, so the one
                          part of a phone number people get wrong is the part
                          they no longer have to enter — and a number typed
                          with the code anyway, or a foreign number in full
                          international form, is still accepted by
                          `normalizePhone`. */}
                      <div className="mt-1.5 flex items-stretch gap-2">
                        {shownDial && (
                          <span className="flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 text-body-sm text-[var(--color-content)]">
                            {shownFlag} {shownDial}
                          </span>
                        )}
                        <Input
                          id="phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          // No fake per-country example: an invented local
                          // format is worse than none, and the prefix chip
                          // already says which country's number this is.
                          placeholder={dialCode ? 'Your number' : '+250 788 123 456'}
                          className="mt-0"
                        />
                      </div>
                      {typed && typed.dialCode !== dialCode ? (
                        <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                          Saving this as a {typed.dialCode} number, not a {dialCode} one — that's
                          what you typed.
                        </p>
                      ) : (
                        <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                          {dialCode
                            ? `Just the local part — we add ${dialCode}. A number from another country works too, typed in full.`
                            : 'Include your country code, e.g. +250 788 123 456.'}
                        </p>
                      )}
                      <FieldStatus
                        state={phoneAvailability}
                        taken="That number is already on an AutoHire account."
                        free="Looks free."
                      />
                    </div>
                  </>
                )}

                {mode === 'signin' && (
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
                )}

                {(mode === 'signin' || step === 3) && (
                  <>
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
                <p className="mt-4 text-center text-body-sm text-[var(--color-content-muted)] [@media(max-height:680px)]:mt-2 sm:mt-6">
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
