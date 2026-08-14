import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera } from 'lucide-react';
import { Button, Modal } from '@/components/ui';

/**
 * In-browser camera capture that works on any device — desktop webcam or a
 * phone's front/back camera — unlike an `<input type="file" capture>`, which
 * most desktop browsers just ignore and fall back to a plain file picker.
 * Streams `getUserMedia` into a live preview; "Capture" snapshots the current
 * frame to a JPEG File and hands it back via `onCapture`.
 */
export function CameraCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser — use "From gallery" instead.');
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      // Prefer the back camera on a phone; any camera works everywhere else.
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't access the camera — check your browser's permission, or use \"From gallery\" instead.");
        }
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        onClose();
      },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Take a photo">
      <div className="space-y-3">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="relative aspect-video overflow-hidden rounded-lg bg-ink-900">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                Starting camera…
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!error && (
            <Button onClick={capture} disabled={!ready}>
              <Camera size={15} /> Capture
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
