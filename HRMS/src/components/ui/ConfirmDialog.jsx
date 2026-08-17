import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
}) {
  // Autofocus the Confirm button so pressing Enter right after the dialog
  // opens confirms the action, per the app's Enter-key convention.
  const confirmRef = useRef(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      initialFocusRef={confirmRef}
      titleId="confirm-dialog-title"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div
          className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${
            tone === 'danger' ? 'bg-danger/12 text-danger' : 'bg-warning/15 text-warning'
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h3 id="confirm-dialog-title" className="text-sm font-semibold text-fg">{title}</h3>
          <p className="mt-1 text-sm text-fg-muted">{message}</p>
        </div>
      </div>
    </Modal>
  );
}
