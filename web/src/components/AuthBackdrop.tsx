import { useEffect, useRef, useState } from 'react';

/**
 * The full-bleed backdrop behind the sign-in / sign-up screen: a car driving
 * into the sunset, looping silently.
 *
 * Clip: mixkit.co "Luxury white sports car in the highway at sunset", used
 * under the Mixkit Free License (commercial use, no attribution required, no
 * redistribution as a standalone file). Re-encoded to 13s / 720p / no audio /
 * ~800KB and committed as `public/media/cars-driving.mp4`.
 *
 * **The poster image is the real background; the video is the enhancement.**
 * `cars-driving.jpg` (35KB) paints immediately and stays underneath, so the
 * screen is never empty and never shifts — the video fades in on top only once
 * it can actually play. That ordering matters here more than it looks: this is
 * the one screen a brand-new user meets, often on a Rwandan mobile connection,
 * and a sign-in form that waits on 800KB of video is a worse product than one
 * with a still photo behind it.
 *
 * The video is skipped entirely — poster only, nothing downloaded — when:
 *  - the visitor asked for reduced motion, or
 *  - the browser reports Save-Data, or a 2g-class connection.
 * Both are read once at mount rather than watched: this component's whole life
 * is the few seconds someone spends signing in.
 */

const POSTER = '/media/cars-driving.jpg';
const VIDEO = '/media/cars-driving.mp4';

/** Save-Data / effective connection type — non-standard, so feature-detected. */
type SaveDataConnection = { saveData?: boolean; effectiveType?: string };

function shouldPlayVideo(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = (navigator as Navigator & { connection?: SaveDataConnection }).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && /^(slow-)?2g$/.test(conn.effectiveType)) return false;
  return true;
}

export function AuthBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Decided once, at mount: a connection that changes mid-sign-in shouldn't
  // start or stop a background video under the person typing.
  const [wantsVideo] = useState(shouldPlayVideo);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Safari/iOS ignore the `autoplay` attribute often enough that the play
    // has to be asked for. It can still be refused (low-power mode); the
    // poster is already on screen, so a rejection needs no handling.
    void video.play().catch(() => {});
  }, [wantsVideo]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <img src={POSTER} alt="" className="h-full w-full object-cover" />

      {wantsVideo && (
        <video
          ref={videoRef}
          src={VIDEO}
          poster={POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={() => setReady(true)}
          className={[
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
            ready ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        />
      )}

      {/* Two scrims: a flat tint that carries most of the contrast, and a
          gradient that is heavier at the top and bottom so the middle of the
          frame — where the car is — stays the brightest thing on screen.
          Both amounts are theme tokens (`index.css`), because the light theme
          needs far less of them than the dark one. */}
      <div className="absolute inset-0 bg-[var(--auth-scrim)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--auth-scrim-edge),transparent_42%,var(--auth-scrim-edge))]" />
    </div>
  );
}
