import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Building2,
  Camera,
  CheckCircle2,
  Phone,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { Host, UserProfile } from '@autohire/shared';
import { client } from '@/lib/client';
import { useAuth } from '@/lib/auth';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { normalizePhone } from '@/lib/phone';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Input, Label, Modal, Spinner } from '@/components/ui';

/** Account settings: shows who you are and lets you permanently delete the account. */
export function AccountPage() {
  const { user, deleteAccount } = useAuth();
  const { data, isLoading } = useCurrentUser();
  // A company account's profile row carries the host columns (owner_type, etc.).
  const profile = data as (UserProfile & Partial<Host>) | undefined;
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCompany = profile?.ownerType === 'business';

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

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink-900">Account</h1>
      <p className="mt-1 text-sm text-ink-500">Manage your AutoHire account.</p>

      {isLoading || !profile ? (
        <Card className="mt-6">
          <CardBody className="flex justify-center py-6">
            <Spinner size={22} />
          </CardBody>
        </Card>
      ) : (
        <ProfileCard profile={profile} email={user?.email ?? ''} />
      )}

      {/* Phone verification */}
      <PhoneVerification defaultPhone={profile?.phone ?? ''} />

      {/* Danger zone */}
      <Card className="mt-6 border-red-200">
        <CardHeader className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-red-600" />
          <h2 className="font-semibold text-red-700">Delete account</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-600">
            Permanently deletes your login and all of your data — {isCompany ? 'fleet listings' : 'listings'},
            bookings, messages, reviews, documents, and notifications. This cannot be undone.
          </p>
          <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmOpen(true)}>
            Delete my account
          </Button>
        </CardBody>
      </Card>

      <Modal open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="Delete account?">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            This is permanent. Type <span className="font-semibold text-ink-900">DELETE</span> to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
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

/** Editable profile: avatar + name, plus the host/renter role switch. */
function ProfileCard({ profile, email }: { profile: UserProfile & Partial<Host>; email: string }) {
  const queryClient = useQueryClient();
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
    setBusy(true);
    setError(null);
    try {
      await client.updateProfile(
        isHost ? { role: 'renter' } : { role: 'owner', ownerType: 'individual' },
      );
      // Mode, nav and host/renter pages all key off the role — refresh broadly.
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
      queryClient.invalidateQueries({ queryKey: ['ownerListings'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="font-semibold text-ink-900">Profile</h2>
      </CardHeader>
      <CardBody className="space-y-5">
        {/* Avatar + change photo */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar name={displayName} src={profile.avatarUrl} size="lg" />
            <label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 shadow-sm hover:bg-ink-50">
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
            <p className="font-medium text-ink-900">{displayName}</p>
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
            {uploading && <p className="mt-1 text-xs text-ink-500">Uploading photo…</p>}
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
              <span className="flex items-center gap-1 text-sm text-emerald-700">
                <CheckCircle2 size={14} /> Saved
              </span>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">{email || '—'}</Field>
          <Field label="Phone">{profile.phone || 'Not set'}</Field>
        </dl>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Host / renter switch — companies are host-only. */}
        {!isCompany && (
          <div className="rounded-lg bg-ink-50 p-3">
            <p className="text-sm font-medium text-ink-800">
              {isHost ? 'Hosting account' : 'Renter account'}
            </p>
            <p className="mt-0.5 text-sm text-ink-600">
              {isHost
                ? 'You manage listings. Switch to renting to book cars (your listings are kept).'
                : 'You rent cars. Become a host to list your own vehicle.'}
            </p>
            <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={toggleRole}>
              <ArrowLeftRight size={14} /> {isHost ? 'Switch to renting' : 'Become a host'}
            </Button>
          </div>
        )}

        <Link
          to="/verification"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          <ShieldCheck size={15} /> Verification & documents
        </Link>
      </CardBody>
    </Card>
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
    <Card className="mt-6">
      <CardHeader className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-ink-900">
          <Phone size={16} className="text-brand-600" /> Phone verification
        </h2>
        {verified && (
          <Badge tone="success">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={13} /> Verified
            </span>
          </Badge>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {verified ? (
          <p className="text-sm text-ink-600">
            Your phone number is verified. SMS updates will go to{' '}
            <span className="font-medium text-ink-900">{defaultPhone || user?.phone}</span>.
          </p>
        ) : !codeSent ? (
          <>
            <p className="text-sm text-ink-600">
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-600">
              Enter the 6-digit code we sent to{' '}
              <span className="font-medium text-ink-900">{phone}</span>.
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
            {error && <p className="text-sm text-red-600">{error}</p>}
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
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{children}</dd>
    </div>
  );
}
