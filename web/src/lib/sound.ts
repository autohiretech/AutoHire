// A short, pleasant two-note "ping" played on new messages / notifications.
// Uses the Web Audio API so there's no audio asset to bundle. Browser autoplay
// rules mean it only sounds after the user has interacted with the page, which
// is always true by the time a realtime event arrives.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function beep(at: number, freq: number, duration: number) {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Quick attack, smooth decay so it sounds like a chime, not a click.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + duration);
}

/** Play the notification chime (no-op if audio is unavailable/blocked). */
export function playPing(): void {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume().catch(() => {});
  const now = audio.currentTime;
  beep(now, 880, 0.14); // A5
  beep(now + 0.12, 1320, 0.18); // E6
}
