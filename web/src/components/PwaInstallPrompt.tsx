import { useEffect, useState } from 'react';
import { Share, SquarePlus } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { BrandMark } from '@/components/BrandMark';
import { usePwaInstall } from '@/lib/usePwaInstall';
import { useT } from '@/lib/i18n';

const DISMISS_KEY = 'autohire.pwa-install-dismissed-at';
// Re-asking on every visit is what the user explicitly flagged as a bug in
// an earlier prompt on this app ("download modal evetime they refresh") —
// once dismissed, stay quiet for two weeks rather than track a permanent
// "never ask again" that would make a change of heart impossible to reach.
const BACKOFF_MS = 14 * 24 * 60 * 60 * 1000;
// Let the page the renter came for load first — a prompt racing the hero
// reads as an interstitial ad, not something the app offers.
const SHOW_DELAY_MS = 4000;

/**
 * Never on the first visit.
 *
 * Verified on the live site at 390px: a first-time visitor, logged out, had
 * this sheet over the bottom third of the screen before a single car was in
 * view — the only thing they had seen of AutoHire was a location card, a
 * hero and a row of chips, and we were already asking them to install it.
 * Nobody installs an app they have not used yet; they close the sheet, and
 * the two-week backoff below then keeps us quiet for exactly the fortnight in
 * which they might actually have wanted it.
 *
 * So the first load only stamps when this device first saw us, and the sheet
 * is allowed from a *return* visit onward. "Return" is measured from that
 * stamp, not from a session flag: a refresh, a second tab, or a long first
 * browse all stay inside `RETURN_AFTER_MS`, while coming back later that day
 * or tomorrow does not — which is the visit where someone who found a car
 * they liked is worth asking. The alternative gate ("after a search or a
 * car opened") would need those pages to report back here; this one is
 * self-contained and needs no cooperation from anywhere else in the app.
 *
 * Storage that is blocked (private mode) reads as "first visit" every time,
 * so in that mode the prompt simply never shows — the safe side to fail on.
 */
const FIRST_SEEN_KEY = 'autohire.first-seen-at';
const RETURN_AFTER_MS = 6 * 60 * 60 * 1000;

function isReturnVisit(): boolean {
  try {
    const raw = localStorage.getItem(FIRST_SEEN_KEY);
    const at = Number(raw);
    if (!raw || !Number.isFinite(at)) {
      localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
      return false;
    }
    return Date.now() - at >= RETURN_AFTER_MS;
  } catch {
    return false;
  }
}

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
  const t = useT();
  // Decided once per mount, not per render: the first call is also what
  // writes the first-seen stamp, and re-evaluating it later in the same
  // mount would turn a long first visit into a "return" mid-page.
  const [returning] = useState(isReturnVisit);

  const eligible = returning && !installed && (canPromptNatively || isIosSafari);

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
    <Modal open={open} onClose={dismiss} title={t('install.title')}>
      <div className="flex flex-col items-center gap-4 text-center">
        {/* The icon that is about to land on their home screen, not a
            download glyph: an install prompt is a preview of the thing, and
            this is the same tile the manifest ships. */}
        <div className="flex h-16 w-16 items-center justify-center rounded-[22%] bg-brand-600 text-white shadow-sm">
          <BrandMark size={44} />
        </div>

        {isIosSafari && !canPromptNatively ? (
          <>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              {t('install.iosBody')}
            </p>
            <div className="w-full space-y-2.5 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-4 text-left text-body-sm text-[var(--color-content)]">
              <p className="flex items-center gap-2.5">
                <Share size={16} className="shrink-0 text-[var(--color-content-muted)]" />
                {t('install.iosStep1')}
              </p>
              <p className="flex items-center gap-2.5">
                <SquarePlus size={16} className="shrink-0 text-[var(--color-content-muted)]" />
                {t('install.iosStep2')}
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={dismiss}>
              {t('common.gotIt')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-body-sm text-[var(--color-content-muted)]">
              {t('install.body')}
            </p>
            <div className="flex w-full gap-2.5">
              <Button type="button" variant="outline" className="flex-1" onClick={dismiss}>
                {t('common.notNow')}
              </Button>
              <Button type="button" className="flex-1" onClick={install}>
                {t('install.install')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
