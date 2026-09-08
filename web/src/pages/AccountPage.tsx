import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
  LogOut,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Star,
  User,
} from 'lucide-react';
import type { Host, UserProfile } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCountry, type Country } from '@/lib/country';
import { normalizePhone } from '@/lib/phone';
import { PAYMENTS_PAYHOLD } from '@/lib/payments';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Label,
  ListGroup,
  ListRow,
  Modal,
  Notice,
  Spinner,
} from '@/components/ui';

/** Account settings: shows who you are and lets you permanently delete the account. */
export function AccountPage() {
  const { user, signOut, deleteAccount } = useAuth();
  const { data, isLoading } = useCurrentUser();
  // A company account's profile row carries the host columns (owner_type, etc.).
  const profile = data as (UserProfile & Partial<Host>) | undefined;
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCompany = profile?.ownerType === 'business';
  const isHost = profile?.role === 'owner';
  const phoneVerified = Boolean(user?.phone_confirmed_at);

  async function onDelete() {
    setError(null);
    setBusy(true);
    try {
      await deleteAccount();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.');
      setBusy(false);
    }
  }

  async function onSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <h1 className="text-h1">Account</h1>
      <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
        Manage your AutoHire account.
      </p>

      {isLoading || !profile ? (
        <div className="mt-10 flex justify-center">
          <Spinner size={22} />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* Genuine states that need this account's attention, surfaced up
              front rather than buried in the sections below. */}
          {isHost && profile.payoutStatus !== 'active' && (
            <Notice tone="warn">
              <Banknote size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">
                  {profile.payoutStatus === 'pending'
                    ? 'Your payout method is being verified'
                    : 'Add a payout method to get paid'}
                </p>
                <p className="mt-0.5">
                  {profile.payoutStatus === 'pending'
                    ? 'Earnings keep building up in the meantime.'
                    : "You won't be able to receive earnings until one is on file."}
                </p>
                {profile.payoutStatus !== 'pending' && (
                  <Link
                    to="/payouts/setup"
                    className="mt-2 inline-block text-body-sm font-semibold underline underline-offset-2"
                  >
                    Set up payouts
                  </Link>
                )}
              </div>
            </Notice>
          )}
          {!phoneVerified && (
            <Notice tone="info">
              <Phone size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Verify your phone number</p>
                <p className="mt-0.5">
                  Get booking and pickup updates by SMS — see the Phone section below.
                </p>
              </div>
            </Notice>
          )}

          <ProfileCard profile={profile} email={user?.email ?? ''} />

          <PhoneVerification defaultPhone={profile.phone ?? ''} />

          <ListGroup label="Account">
            <ListRow icon={<ShieldCheck size={18} />} to="/verification">
              Verification & documents
            </ListRow>
            {/* Watching is a renter's tool — hosts and companies can't book. */}
            {!isHost && !isCompany && (
              <ListRow icon={<Star size={18} />} to="/watchlist">
                Cars you're watching
              </ListRow>
            )}
          </ListGroup>

          {/* Companies are host-only, and the renter/host switch itself lives
              inline in the Profile card above (it needs explanatory copy a
              plain row can't carry) — this group only holds the payout row. */}
          {isHost && (
            <ListGroup label="Hosting">
              <ListRow
                icon={<Banknote size={18} />}
                to="/payouts/setup"
                value={payoutStatusLabel(profile.payoutStatus)}
              >
                Payout method
              </ListRow>
            </ListGroup>
          )}

          <ListGroup label="Support">
            <ListRow icon={<LogOut size={18} />} onClick={onSignOut}>
              Sign out
            </ListRow>
          </ListGroup>

          {/* Danger zone — kept last and visually distinct, on purpose: this
              is the one destructive, irreversible action on the page. */}
          <Notice tone="danger" className="flex-col items-stretch">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="shrink-0" />
              <h2 className="text-body font-semibold">Delete account</h2>
            </div>
            <p className="mt-1">
              Permanently deletes your login and all of your data —{' '}
              {isCompany ? 'fleet listings' : 'listings'}, bookings, messages, reviews, documents,
              and notifications. This cannot be undone.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-3 self-start"
              onClick={() => setConfirmOpen(true)}
            >
              Delete my account
            </Button>
          </Notice>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="Delete account?">
        <div className="space-y-4">
          <p className="text-body-sm text-[var(--color-content-muted)]">
            This is permanent. Type{' '}
            <span className="font-semibold text-[var(--color-content)]">DELETE</span> to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          {error && <p className="text-body-sm text-[var(--color-danger-500)]">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== 'DELETE' || busy}
              onClick={onDelete}
            >
              {busy ? 'Deleting…' : 'Permanently delete'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function payoutStatusLabel(status?: string): string {
  if (status === 'active') return 'Active';
  if (status === 'pending') return 'Verifying';
  return 'Not set';
}

/** Editable profile: avatar + name, plus the host/renter role switch. */
function ProfileCard({ profile, email }: { profile: UserProfile & Partial<Host>; email: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isCompany = profile.ownerType === 'business';
  const isHost = profile.role === 'owner';
  const displayName = profile.businessName ?? profile.fullName;

  const currentName = (isCompany ? profile.businessName : profile.fullName) ?? '';
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setName(currentName), [currentName]);

  const nameChanged = name.trim().length > 0 && name.trim() !== currentName;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
  }

  async function saveName() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await client.updateProfile(
        isCompany ? { businessName: name.trim() } : { fullName: name.trim() },
      );

      // PayHold's Sellers dashboard identifies who money is owed to by this
      // name — an edit that never reached it would leave that name drifting
      // from the truth every time a host changed it. Best-effort and
      // non-blocking, same as the toggleRole() calls below: a host must never
      // be blocked from saving their own name by a PayHold hiccup.
      if (isHost && PAYMENTS_PAYHOLD) {
        client.syncPayholdSellerName().catch((e) => {
          console.error('syncPayholdSellerName failed', e);
        });
      }

      refresh();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  }

  async function onPickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await client.uploadAvatar(file);
      await client.updateProfile({ avatarUrl: url });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the picture.');
    } finally {
      setUploading(false);
    }
  }

  async function toggleRole() {
    const becomingHost = !isHost;
    setBusy(true);
    setError(null);
    try {
      await client.updateProfile(
        isHost ? { role: 'renter' } : { role: 'owner', ownerType: 'individual' },
      );

      // Becomes a PayHold seller with no payout destination yet — money can
      // start accruing against them the moment they list a car, rather than
      // only once they reach payout setup. Best-effort and non-blocking: it
      // is safe to skip here, because `registerPayholdSeller` on the payout
      // setup screen does the identical get-or-create the first time a
      // destination is actually typed. A host must never be blocked from
      // becoming a host by a PayHold hiccup.
      if (PAYMENTS_PAYHOLD) {
        if (becomingHost) {
          client.ensurePayholdSeller().catch((e) => {
            console.error('ensurePayholdSeller failed', e);
          });
        } else {
          // Switching back to renter. Status only on PayHold's side — money
          // already owed to them keeps moving on its own schedule — so this
          // is best-effort and non-blocking exactly like the host direction.
          client.deactivatePayholdSeller().catch((e) => {
            console.error('deactivatePayholdSeller failed', e);
          });
        }
      }

      // Mode, nav and host/renter pages all key off the role — refresh broadly.
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
      queryClient.invalidateQueries({ queryKey: ['ownerListings'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      // New hosts need a payout method before they can earn — send them straight
      // to set one up (unless they already have one on file).
      if (becomingHost && profile.payoutStatus !== 'active') {
        navigate('/payouts/setup');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h4">Profile</h2>
          <Badge tone={isCompany ? 'brand' : 'neutral'}>
            {isCompany ? (
              <span className="flex items-center gap-1">
                <Building2 size={13} /> Company {isHost ? '· host' : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <User size={13} /> Personal {isHost ? '· host' : '· renter'}
              </span>
            )}
          </Badge>
        </div>

        {/* Avatar + change photo */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar name={displayName} src={profile.avatarUrl} size="lg" />
            <label className="absolute -right-1 -bottom-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-raised)] text-[var(--color-content-muted)] shadow-[var(--shadow-float)] hover:bg-[var(--color-surface-sunken)]">
              <Camera size={14} />
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={onPickAvatar}
                className="hidden"
              />
            </label>
          </div>
          <div>
            <p className="font-medium text-[var(--color-content)]">{displayName}</p>
            {uploading && (
              <p className="mt-1 text-caption text-[var(--color-content-muted)]">
                Uploading photo…
              </p>
            )}
          </div>
        </div>

        {/* Editable name */}
        <div>
          <Label htmlFor="display-name">{isCompany ? 'Company name' : 'Full name'}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="display-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              className="max-w-sm"
            />
            <Button size="sm" disabled={!nameChanged || busy} onClick={saveName}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {saved && !nameChanged && (
              <span className="flex items-center gap-1 text-body-sm text-brand-700 dark:text-brand-300">
                <CheckCircle2 size={14} /> Saved
              </span>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">{email || '—'}</Field>
          <Field label="Phone">{profile.phone || 'Not set'}</Field>
        </dl>

        <CountryField profile={profile} />

        {error && <p className="text-body-sm text-[var(--color-danger-500)]">{error}</p>}

        {/* Host / renter switch — companies are host-only. Kept inline (rather
            than folded into the ListGroup below) because it needs this
            explanatory copy, not just a label and a chevron. */}
        {!isCompany && (
          <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] p-3">
            <p className="text-body-sm font-medium text-[var(--color-content)]">
              {isHost ? 'Hosting account' : 'Renter account'}
            </p>
            <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
              {isHost
                ? 'You manage listings. Switch to renting to book cars (your listings are kept).'
                : 'You rent cars. Become a host to list your own vehicle.'}
            </p>
            <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={toggleRole}>
              <ArrowLeftRight size={14} /> {isHost ? 'Switch to renting' : 'Become a host'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The country this account pays from / is paid into — an account fact, not the
 * header's market selector (that one only filters the catalogue and switches
 * the display currency, and lives in localStorage). Payout routing reads this,
 * so guessing it from a browse preference put hosts on the wrong rail.
 *
 * When the external payment system is connected it becomes the authority on
 * this; until then it's set here.
 */
function CountryField({ profile }: { profile: UserProfile }) {
  const { countries } = useCountry();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = countries.find((c) => c.code === profile.country);
  const label = (c: Country) => `${c.flag} ${c.name}`;

  // Show the saved country when idle; typing takes over as a live filter and
  // reverts to the saved value on blur/close if nothing was picked.
  useEffect(() => {
    if (!open) setQuery(selected ? label(selected) : '');
  }, [open, selected?.code]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selected && q === label(selected).toLowerCase())) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countries, query, selected]);

  async function save(code: string) {
    if (!code || code === profile.country) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await client.updateProfile({ country: code });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your country.');
    } finally {
      setBusy(false);
    }
  }

  function choose(c: Country) {
    setOpen(false);
    void save(c.code);
  }

  return (
    <div ref={boxRef} className="relative">
      <Label htmlFor="account-country">Country</Label>
      <Input
        id="account-country"
        value={query}
        disabled={busy}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Search countries…"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface-raised)] py-1 shadow-[var(--shadow-float)]">
          {results.length === 0 ? (
            <li className="px-3 py-4 text-center text-body-sm text-[var(--color-content-subtle)]">
              No countries match &ldquo;{query}&rdquo;
            </li>
          ) : (
            results.map((c, i) => (
              <li key={c.code}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm',
                    i === active && 'bg-[var(--color-surface-sunken)]',
                    c.code === profile.country && 'font-medium text-brand-700 dark:text-brand-300',
                  )}
                >
                  <span className="w-5 shrink-0 text-center">{c.flag}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <p className="mt-1 text-caption text-[var(--color-content-muted)]">
        {profile.role === 'owner'
          ? 'Where you get paid — it decides which payout methods you can use.'
          : 'Where you pay from — it decides which payment methods you can use.'}
      </p>
      {saved && (
        <p className="mt-1 flex items-center gap-1 text-caption text-brand-700 dark:text-brand-300">
          <CheckCircle2 size={13} /> Saved
        </p>
      )}
      {error && <p className="mt-1 text-caption text-[var(--color-danger-500)]">{error}</p>}
    </div>
  );
}

/** Verify the account's phone number by SMS one-time code. */
function PhoneVerification({ defaultPhone }: { defaultPhone: string }) {
  const { user, sendPhoneOtp, verifyPhoneOtp } = useAuth();
  const verified = Boolean(user?.phone_confirmed_at);

  const [phone, setPhone] = useState(defaultPhone);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill once the profile's phone loads (without clobbering edits).
  useEffect(() => {
    if (defaultPhone) setPhone((p) => p || defaultPhone);
  }, [defaultPhone]);

  async function send() {
    setError(null);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError('Enter a valid phone number with country code, e.g. +250 788 123 456.');
      return;
    }
    setBusy(true);
    try {
      await sendPhoneOtp(normalized);
      setPhone(normalized);
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      await verifyPhoneOtp(phone, code.trim());
      setCodeSent(false);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-h4">
            <Phone size={16} className="text-[var(--color-accent-on)]" /> Phone verification
          </h2>
          {verified && (
            <Badge tone="success">
              <span className="flex items-center gap-1">
                <CheckCircle2 size={13} /> Verified
              </span>
            </Badge>
          )}
        </div>

        {verified ? (
          <p className="text-body-sm text-[var(--color-content-muted)]">
            Your phone number is verified. SMS updates will go to{' '}
            <span className="font-medium text-[var(--color-content)]">
              {defaultPhone || user?.phone}
            </span>
            .
          </p>
        ) : !codeSent ? (
          <>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              Verify your number so we can send booking and pickup updates by SMS.
            </p>
            <div>
              <Label htmlFor="verify-phone">Phone number</Label>
              <Input
                id="verify-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+250 788 123 456"
              />
            </div>
            {error && <p className="text-body-sm text-[var(--color-danger-500)]">{error}</p>}
            <Button onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </>
        ) : (
          <>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              Enter the 6-digit code we sent to{' '}
              <span className="font-medium text-[var(--color-content)]">{phone}</span>.
            </p>
            <div>
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            {error && <p className="text-body-sm text-[var(--color-danger-500)]">{error}</p>}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setCodeSent(false)} disabled={busy}>
                Back
              </Button>
              <Button onClick={verify} disabled={busy || code.trim().length < 4}>
                {busy ? 'Verifying…' : 'Verify'}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-[var(--color-content-muted)]">{label}</dt>
      <dd className="mt-0.5 text-body-sm font-medium text-[var(--color-content)]">{children}</dd>
    </div>
  );
}
