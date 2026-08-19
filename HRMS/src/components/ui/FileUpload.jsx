import { useEffect, useRef, useState } from 'react';
import { UploadCloud, File, X } from 'lucide-react';
import { cn } from '../../lib/utils';

function FilePreviewThumb({ file }) {
  const [url, setUrl] = useState(null);
  const isImage = file.type?.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  if (isImage && url) {
    return <img src={url} alt="" className="h-8 w-8 rounded-md object-cover shrink-0" />;
  }
  return (
    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
      <File className="h-4 w-4 text-primary" />
    </div>
  );
}

/**
 * Lightweight drag-and-drop file uploader (no external deps).
 * Purely client-side — tracks selected files in local state.
 */
export function FileUpload({
  accept = '.pdf,.jpg,.jpeg,.png',
  multiple = true,
  maxSizeMB = 5,
  hint = 'PDF, JPG or PNG · up to 5MB each',
  onChange,
  value = null,
}) {
  const inputRef = useRef();
  const [files, setFiles] = useState(() => (value ? [value] : []));
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const acceptedExts = accept.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

  const addFiles = (list) => {
    setError('');
    const incoming = Array.from(list);

    const wrongType = incoming.find((f) => {
      if (acceptedExts.length === 0) return false;
      const ext = `.${f.name.split('.').pop().toLowerCase()}`;
      return !acceptedExts.includes(ext);
    });
    if (wrongType) {
      setError(`"${wrongType.name}" isn't an accepted file type (${acceptedExts.join(', ')})`);
      return;
    }

    const tooBig = incoming.find((f) => f.size > maxSizeMB * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" exceeds ${maxSizeMB}MB`);
      return;
    }
    const next = multiple ? [...files, ...incoming] : incoming.slice(0, 1);
    setFiles(next);
    onChange?.(next);
  };

  const remove = (i) => {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    onChange?.(next);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="space-y-3">
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
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'cursor-pointer rounded-input border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'
        )}
      >
        <div className="mx-auto mb-3 h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <UploadCloud className="h-5 w-5 text-primary" />
        </div>
        <p className="text-sm font-medium text-fg">
          <span className="text-primary">Click to upload</span> or drag and drop
        </p>
        <p className="mt-1 text-xs text-fg-subtle">{hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-3 rounded-input border border-border bg-muted/40 px-3 py-2">
              <FilePreviewThumb file={f} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg truncate">{f.name}</p>
                <p className="text-xs text-fg-subtle">{(f.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${f.name}`}
                className="text-fg-subtle hover:text-danger p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
