import { useEffect, useState } from 'react';

/** Chrome/Edge/Android fire this instead of letting the browser show its own
 * install UI, so the app can prompt on its own schedule — but only if the
 * handler calls `preventDefault()` and holds onto the event to replay later. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS's own (non-standard, no beforeinstallprompt) signal that the app
    // is already running from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "Macintosh" but, unlike a real Mac, has a touchscreen.
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  // iOS Chrome/Firefox are Safari-engined but never get a native install
  // path either — only real Safari's Share sheet has "Add to Home Screen".
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

/** Fires `beforeinstallprompt` on Chrome/Edge/Android, detects the iOS Safari
 * case that has no such event (Add to Home Screen is manual, Share-sheet
 * only), and reports whether the app is already installed either way. */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // One-time-use by spec — Chrome never replays a used prompt, so holding
    // onto it after this would just mean a silently broken second tap.
    setDeferred(null);
    return outcome;
  }

  return {
    installed,
    canPromptNatively: deferred !== null,
    isIosSafari: isIosSafari(),
    promptInstall,
  };
}
