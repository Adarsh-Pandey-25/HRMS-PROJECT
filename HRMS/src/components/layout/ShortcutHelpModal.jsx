import { useEffect, useState } from 'react';
import { Modal } from '../ui';

/** Fired by useGlobalShortcuts when the user presses "?" — opens this modal. */
export const SHORTCUT_HELP_EVENT = 'app:shortcut-help';

const SHORTCUTS = [
  { keys: ['/'], action: 'Focus search bar' },
  { keys: ['Ctrl', 'K'], action: 'Open search' },
  { keys: ['Ctrl', 'F'], action: 'Open search' },
  { keys: ['Esc'], action: 'Close modal / drawer / clear search' },
  { keys: ['Ctrl', 'S'], action: 'Save current form / settings' },
  { keys: ['?'], action: 'Show this shortcuts help' },
  { keys: ['Alt', '1'], action: 'Go to Dashboard' },
  { keys: ['Alt', '2'], action: 'Go to Employees' },
  { keys: ['Alt', '3'], action: 'Go to Attendance' },
  { keys: ['Alt', '4'], action: 'Go to Leave' },
  { keys: ['Alt', '5'], action: 'Go to Payroll' },
  { keys: ['Alt', '6'], action: 'Go to Recruitment' },
  { keys: ['Alt', '7'], action: 'Go to Performance' },
  { keys: ['Alt', '8'], action: 'Go to Training' },
  { keys: ['Alt', '9'], action: 'Go to Assets' },
  { keys: ['Alt', '0'], action: 'Go to Helpdesk' },
  { keys: ['Tab'], action: 'Next interactive element' },
  { keys: ['Shift', 'Tab'], action: 'Previous element' },
  { keys: ['↑', '↓'], action: 'Navigate lists / tables' },
  { keys: ['←', '→'], action: 'Navigate dropdowns / calendar' },
  { keys: ['Enter'], action: 'Select / activate' },
  { keys: ['Space'], action: 'Toggle checkbox / switch' },
];

function Keys({ keys }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-fg-subtle text-xs">+</span>}
          <kbd className="min-w-[24px] text-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-fg shadow-sm">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/** Keyboard-shortcut reference. Mounted once in AppLayout; opens on "?". */
export function ShortcutHelpModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(SHORTCUT_HELP_EVENT, onOpen);
    return () => window.removeEventListener(SHORTCUT_HELP_EVENT, onOpen);
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" subtitle="Work faster without leaving the keyboard" size="lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
        {SHORTCUTS.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm text-fg-muted">{s.action}</span>
            <Keys keys={s.keys} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
