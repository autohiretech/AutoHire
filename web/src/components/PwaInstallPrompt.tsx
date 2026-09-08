import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { usePwaInstall } from '@/lib/usePwaInstall';

const DISMISS_KEY = 'autohire.pwa-install-dismissed-at';
// Re-asking on every visit is what the user explicitly flagged as a bug in
// an earlier prompt on this app ("download modal evetime they refresh") —
// once dismissed, stay quiet for two weeks rather than track a permanent
// "never ask again" that would make a change of heart impossible to reach.
const BACKOFF_MS = 14 * 24 * 60 * 60 * 1000;
// Let the page the renter came for load first — a prompt racing the hero
// reads as an interstitial ad, not something the app offers.
const SHOW_DELAY_MS = 4000;

function recentlyDismissed(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const at = Number(raw);
  return Number.isFinite(at) && Date.now() - at < BACKOFF_MS;
}

/** Turo/Uber-style install nudge — reuses the same bottom-sheet-on-mobile
 * `Modal` as everything else in the app, not a bespoke banner. Handles both
 * real install paths: Chrome/Edge/Android's native `beforeinstallprompt`,
 * and iOS Safari, which has no such event and only ever gets there through
 * its own Share sheet — so that case is instructions, not a button. */
export function PwaInstallPrompt() {
  const { installed, canPromptNatively, isIosSafari, promptInstall } = usePwaInstall();
  const [open, setOpen] = useState(false);

  const eligible = !installed && (canPromptNatively || isIosSafari);

  useEffect(() => {
    if (!eligible || recentlyDismissed()) return;
    const t = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
    // `canPromptNatively` flips true asynchronously once Chrome fires
    // `beforeinstallprompt`, well after mount — re-run the eligibility
    // check whenever it changes instead of only capturing it once.
  }, [eligible]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setOpen(false);
  }

  async function install() {
    const outcome = await promptInstall();
    // Chrome's own picker was declined — same backoff as an explicit close,
    // rather than asking again the instant they refresh.
    if (outcome !== 'accepted') dismiss();
    else setOpen(false);
  }

  return (
    <Modal open={open} onClose={dismiss} title="Get the AutoHire app">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-card)] bg-[var(--color-accent-on)]/10">
          <Download size={26} className="text-[var(--color-accent-on)]" />
        </div>

        {isIosSafari && !canPromptNatively ? (
          <>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              Add AutoHire to your Home Screen for one-tap access, faster loading, and no browser
              bar in the way.
            </p>
            <div className="w-full space-y-2.5 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-4 text-left text-body-sm text-[var(--color-content)]">
              <p className="flex items-center gap-2.5">
                <Share size={16} className="shrink-0 text-[var(--color-content-muted)]" />
                Tap the Share button in Safari's toolbar
              </p>
              <p className="flex items-center gap-2.5">
                <SquarePlus size={16} className="shrink-0 text-[var(--color-content-muted)]" />
                Then choose "Add to Home Screen"
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={dismiss}>
              Got it
            </Button>
          </>
        ) : (
          <>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              Install AutoHire for one-tap access, faster loading, and no browser bar in the way.
            </p>
            <div className="flex w-full gap-2.5">
              <Button type="button" variant="outline" className="flex-1" onClick={dismiss}>
                Not now
              </Button>
              <Button type="button" className="flex-1" onClick={install}>
                Install
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
