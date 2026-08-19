import { useRef } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
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
  const confirmRef = useRef(null);
  const isDanger = tone === 'danger';
  const Icon = isDanger ? ShieldAlert : AlertTriangle;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      initialFocusRef={confirmRef}
      titleId="confirm-dialog-title"
      footer={
        <div className="flex w-full gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="flex-1"
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={isDanger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            className="flex-1"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center text-center py-2">
        <div
          className={`h-14 w-14 rounded-2xl flex items-center justify-center mb-4 ring-4 ${
            isDanger
              ? 'bg-danger/10 text-danger ring-danger/10'
              : 'bg-warning/10 text-warning ring-warning/10'
          }`}
        >
          <Icon className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <h3
          id="confirm-dialog-title"
          className="text-base font-semibold text-fg"
        >
          {title}
        </h3>
        <p className="mt-2 text-sm text-fg-muted leading-relaxed max-w-xs mx-auto">
          {message}
        </p>
      </div>
    </Modal>
  );
}
