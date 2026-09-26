import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, Check, Upload } from 'lucide-react';
import { Modal, Button } from '../ui';
import { uploadCheckInSelfieApi } from '../../api/attendance.api';

const MAX_WIDTH = 640;
const JPEG_QUALITY = 0.85;

const cameraErrorMessage = (err) => {
  if (!window.isSecureContext) return 'The camera only works over a secure (https) connection.';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site in your browser settings, or upload a photo instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. You can upload a photo instead.';
    case 'NotReadableError':
      return 'Your camera is being used by another app. Close it and try again.';
    default:
      return 'Could not start the camera. You can upload a photo instead.';
  }
};

/** Draw a video frame or image to a JPEG no wider than MAX_WIDTH. */
const toJpeg = (source, width, height) => new Promise((resolve, reject) => {
  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the photo'))), 'image/jpeg', JPEG_QUALITY);
});

const fileToJpeg = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    toJpeg(img, img.naturalWidth, img.naturalHeight).then(resolve, reject).finally(() => URL.revokeObjectURL(url));
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('That file is not an image'));
  };
  img.src = url;
});

function SelfieModal({ open, onDone }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [cameraError, setCameraError] = useState('');
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Bumped on every start/stop so a getUserMedia call that resolves after
  // the modal closed (or retake restarted it) releases its camera at once.
  const sessionRef = useRef(0);

  const stopCamera = useCallback(() => {
    sessionRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  // Callback ref: the <video> re-mounts after "Retake", so attach the live
  // stream whenever the element appears rather than only when it starts.
  const attachVideo = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(cameraErrorMessage({ name: 'NotFoundError' }));
      return;
    }
    const session = sessionRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      attachVideo(videoRef.current);
      setReady(true);
    } catch (err) {
      setCameraError(cameraErrorMessage(err));
    }
  }, [attachVideo]);

  useEffect(() => {
    if (!open) return undefined;
    setPhoto(null);
    setUploadError('');
    startCamera();
    return stopCamera;
  }, [open, startCamera, stopCamera]);

  // Free the preview object URL whenever the photo changes or the modal unmounts.
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    try {
      const blob = await toJpeg(video, video.videoWidth, video.videoHeight);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      stopCamera();
    } catch (err) {
      setCameraError(err.message);
    }
  };

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await fileToJpeg(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      stopCamera();
      setCameraError('');
    } catch (err) {
      setUploadError(err.message);
    }
  };

  const retake = () => {
    setPhoto(null);
    setUploadError('');
    stopCamera();
    startCamera();
  };

  const confirm = async () => {
    setUploading(true);
    setUploadError('');
    try {
      const token = await uploadCheckInSelfieApi(photo.blob);
      if (!token) throw new Error('Could not save your selfie');
      onDone(token);
    } catch (err) {
      setUploadError(err.message || 'Could not save your selfie. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const cancel = () => {
    if (uploading) return;
    stopCamera();
    onDone(null);
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      title="Check-in selfie"
      subtitle="Your company asks for a photo when you check in."
      footer={photo ? (
        <>
          <Button variant="outline" icon={RotateCcw} onClick={retake} disabled={uploading}>Retake</Button>
          <Button icon={Check} onClick={confirm} loading={uploading}>Use photo & check in</Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={cancel}>Cancel</Button>
          <Button icon={Camera} onClick={takePhoto} disabled={!ready}>Take photo</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-xl bg-muted">
          {photo ? (
            <img src={photo.url} alt="Your selfie" className="h-full w-full object-cover" />
          ) : (
            <video
              ref={attachVideo}
              playsInline
              muted
              className="h-full w-full object-cover -scale-x-100"
              aria-label="Camera preview"
            />
          )}
          {!photo && !ready && !cameraError && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">Starting camera…</p>
          )}
          {!photo && cameraError && (
            <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-fg-muted">{cameraError}</p>
          )}
        </div>

        {uploadError && <p className="text-sm text-danger text-center">{uploadError}</p>}

        {!photo && (
          <div className="text-center">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" capture="user" className="hidden" onChange={pickFile} />
            <Button size="sm" variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>
              {cameraError ? 'Upload a photo' : 'Use a photo instead'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Selfie gate for check-in. `capture()` opens the camera and resolves with a
 * selfie token to send with check-in, or null if the person cancels.
 * Render `modal` once in the calling component.
 */
export function useSelfieCapture() {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef(null);

  const capture = useCallback(() => new Promise((resolve) => {
    resolverRef.current = resolve;
    setOpen(true);
  }), []);

  const onDone = useCallback((token) => {
    setOpen(false);
    resolverRef.current?.(token);
    resolverRef.current = null;
  }, []);

  return { capture, modal: <SelfieModal open={open} onDone={onDone} /> };
}
