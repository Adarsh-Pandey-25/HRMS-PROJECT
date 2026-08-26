import { useRef, useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { Avatar } from '../../../components/ui';
import toast from 'react-hot-toast';

/**
 * Profile photo picker used by the Add/Edit Employee forms.
 *
 * This file used to also export a full `StepBasicInfo` wizard step, but that
 * component was dead code (never imported anywhere) — only `PhotoUpload` is
 * actually used, by `EmployeeForm.jsx`. It was removed to avoid maintaining
 * an unused, un-exercised copy of the basic-info step.
 */
export function PhotoUpload({ photoFile, onChange, name }) {
  const inputRef = useRef();
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!photoFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(photoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Photo must be an image file');
    if (file.size > 2 * 1024 * 1024) return toast.error('Photo must be under 2MB');
    onChange(file);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar name={name} src={previewUrl} size="xl" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label="Upload employee photo"
          className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-white flex items-center justify-center shadow-card hover:bg-primary-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Camera className="h-3.5 w-3.5" />
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">Employee photo</p>
        <p className="text-xs text-fg-subtle">JPG or PNG, up to 2MB</p>
      </div>
    </div>
  );
}
