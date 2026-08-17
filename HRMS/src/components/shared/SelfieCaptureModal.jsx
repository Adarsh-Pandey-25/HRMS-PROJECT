import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Modal, Button } from '../ui';

/**
 * Lightweight selfie capture for attendance when Settings → selfieRequired is on.
 * Returns a compressed JPEG data URL via onCapture.
 */
export default function SelfieCaptureModal({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError('');
    setReady(false);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch {
        setError('Camera access denied or unavailable. Allow camera permission to continue.');
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      const maxW = 480;
      const scale = Math.min(1, maxW / (video.videoWidth || maxW));
      canvas.width = Math.round((video.videoWidth || maxW) * scale);
      canvas.height = Math.round((video.videoHeight || 360) * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      onCapture(dataUrl);
    } catch {
      setError('Could not capture photo. Try again.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Selfie check-in" subtitle="Take a quick photo to confirm it’s you">
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-xl bg-muted aspect-[4/3]">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover scale-x-[-1]" />
          {!ready && !error && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">Starting camera…</p>
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" icon={Camera} onClick={takePhoto} disabled={!ready || capturing} loading={capturing}>
            Capture
          </Button>
        </div>
      </div>
    </Modal>
  );
}
