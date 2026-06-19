import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Building2, Car, User } from 'lucide-react';
import { useAuth, type AccountType } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { normalizePhone } from '@/lib/phone';
import { Button, Card, CardBody, Input, Label } from '@/components/ui';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<Mode>('signin');
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === 'signup') {
      if (accountType === 'company' && !companyName.trim()) {
        setError('Please enter your company name.');
        return;
      }
      if (!fullName.trim()) {
        setError(accountType === 'company' ? 'Please enter a contact name.' : 'Please enter your full name.');
        return;
      }
      if (!normalizePhone(phone)) {
        setError('Enter a valid phone number with country code, e.g. +250 788 123 456.');
        return;
      }
      if (!acceptedTerms) {
        setError('Please accept the terms to continue.');
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        navigate(from, { replace: true });
      } else {
        const { needsConfirmation } = await signUp(email, password, {
          accountType,
          companyName,
          fullName,
          phone: normalizePhone(phone) ?? phone,
          wantsToHost: accountType === 'personal' && wantsToHost,
        });
        if (needsConfirmation) {
          setInfo('Check your email to confirm your account, then sign in.');
          setMode('signin');
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
    <section className="mx-auto flex max-w-md flex-col px-4 py-12">
      <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-bold text-brand-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Car size={18} />
        </span>
        <span className="text-lg">AutoHire</span>
      </Link>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <h1 className="text-xl font-bold text-ink-900">
              {mode === 'signin' ? 'Sign in' : 'Create your account'}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {mode === 'signin'
                ? 'Welcome back to AutoHire.'
                : 'Rent or host self-drive cars across Rwanda.'}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === 'signup' && (
              <div>
                <Label>Account type</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'personal', label: 'Personal', hint: 'Rent · or list your own car', icon: User },
                      { value: 'company', label: 'Company', hint: 'Fleet / business host', icon: Building2 },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAccountType(opt.value)}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                        accountType === opt.value
                          ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200'
                          : 'border-ink-200 hover:border-ink-300',
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                        <opt.icon size={15} /> {opt.label}
                      </span>
                      <span className="text-xs text-ink-500">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'signup' && accountType === 'personal' && (
              <label className="flex items-start gap-2 rounded-lg border border-ink-200 p-3 text-sm text-ink-600">
                <input
                  type="checkbox"
                  checked={wantsToHost}
                  onChange={(e) => setWantsToHost(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                />
                <span>
                  <span className="font-medium text-ink-900">I want to host my car</span> — start as a
                  host. You can switch between hosting and renting anytime from your profile.
                </span>
              </label>
            )}

            {mode === 'signup' && accountType === 'company' && (
              <div>
                <Label htmlFor="company">Company name</Label>
                <Input
                  id="company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Kigali Car Rental Self Drive"
                  required
                />
              </div>
            )}

            {mode === 'signup' && (
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
                  required
                />
              </div>
            )}

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode === 'signup' && (
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+250 788 123 456"
                  required
                />
                <p className="mt-1 text-xs text-ink-400">
                  Include your country code (e.g. +250 Rwanda, +1 US). Local 07… numbers also work.
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {mode === 'signup' && (
              <label className="flex items-start gap-2 text-sm text-ink-600">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                />
                <span>I agree to AutoHire's terms of service and privacy policy.</span>
              </label>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-emerald-700">{info}</p>}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </Button>
          </form>

          <p className="text-center text-sm text-ink-500">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
                setInfo(null);
              }}
              className="font-medium text-brand-600 hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </CardBody>
      </Card>
    </section>
  );
}
