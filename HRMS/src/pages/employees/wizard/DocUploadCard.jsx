import { useEffect, useRef, useState } from 'react';
import { UploadCloud, File, X, RefreshCw } from 'lucide-react';
import { Badge } from '../../../components/ui';
import { cn } from '../../../lib/utils';
import toast from 'react-hot-toast';

function PreviewThumb({ file }) {
  const [url, setUrl] = useState(null);
  const isImage = file.type?.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  if (isImage && url) return <img src={url} alt="" className="h-9 w-9 rounded-md object-cover shrink-0" />;
  return (
    <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
      <File className="h-4 w-4 text-primary" />
    </div>
  );
}

/**
 * Single-file upload card used by the Add Employee wizard's document steps.
 * Supports click-to-upload, drag & drop, preview, replace and delete — with
 * file type/size validation against the given document type config.
 */
export function DocUploadCard({ docType, value, onChange }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);
  const accept = docType.acceptedFormats.map((f) => `.${f}`).join(',');

  const validate = (file) => {
    const ext = `.${file.name.split('.').pop().toLowerCase()}`;
    if (!docType.acceptedFormats.map((f) => `.${f}`).includes(ext)) {
      toast.error(`"${file.name}" must be ${docType.acceptedFormats.join('/').toUpperCase()}`);
      return false;
    }
    if (file.size > docType.maxSizeMB * 1024 * 1024) {
      toast.error(`"${file.name}" exceeds ${docType.maxSizeMB}MB`);
      return false;
    }
    return true;
  };

  const handleFiles = (list) => {
    const file = list?.[0];
    if (!file) return;
    if (!validate(file)) return;
    onChange(file);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="rounded-input border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-fg">{docType.name}</p>
        {docType.isRequired && <Badge tone="warning">Required</Badge>}
      </div>

      {value ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-md bg-muted/50 px-3 py-2">
          <PreviewThumb file={value} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg truncate">{value.name}</p>
            <p className="text-[11px] text-fg-subtle">{(value.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            type="button"
            onClick={openPicker}
            aria-label={`Replace ${docType.name}`}
            title="Replace"
            className="text-fg-subtle hover:text-primary p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Delete ${docType.name}`}
            title="Delete"
            className="text-fg-subtle hover:text-danger p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          className={cn(
            'mt-3 w-full flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed py-4 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
          )}
        >
          <UploadCloud className="h-4 w-4 text-fg-subtle" />
          <span className="text-xs font-medium text-primary">Click or drag file here</span>
          <span className="text-[10px] text-fg-subtle uppercase">{docType.acceptedFormats.join(' / ')} · Max {docType.maxSizeMB}MB</span>
        </div>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
    </div>
  );
}
