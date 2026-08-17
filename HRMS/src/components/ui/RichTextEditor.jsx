import { useRef, useEffect } from 'react';
import { Bold, Italic, List, ListOrdered, Heading2, Undo, Redo } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Minimal rich-text editor on contentEditable + document.execCommand.
 * Never rewrites DOM while focused — that caused reverse typing (cursor jump to start).
 */
export function RichTextEditor({ value = '', onChange, placeholder = 'Write something…', minHeight = 140, className }) {
  const ref = useRef(null);
  const focused = useRef(false);
  const lastEmitted = useRef(value);

  // Sync from parent only when empty/reset or when not typing in this field
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused.current) return;
    if (value === lastEmitted.current) return;
    if (el.innerHTML === value) {
      lastEmitted.current = value;
      return;
    }
    el.innerHTML = value || '';
    lastEmitted.current = value;
  }, [value]);

  const emit = (html) => {
    lastEmitted.current = html;
    onChange?.(html);
  };

  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
    emit(ref.current?.innerHTML || '');
  };

  const tools = [
    { icon: Bold, cmd: 'bold' },
    { icon: Italic, cmd: 'italic' },
    { icon: Heading2, cmd: 'formatBlock', arg: 'h3' },
    { icon: List, cmd: 'insertUnorderedList' },
    { icon: ListOrdered, cmd: 'insertOrderedList' },
    { icon: Undo, cmd: 'undo' },
    { icon: Redo, cmd: 'redo' },
  ];

  return (
    <div className={cn('rounded-input border border-border bg-card overflow-hidden focus-within:ring-2 focus-within:ring-primary', className)}>
      <div className="flex items-center gap-0.5 border-b border-border/60 bg-muted/40 px-2 py-1.5">
        {tools.map(({ icon: Icon, cmd, arg }, i) => (
          <button
            key={i}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(cmd, arg)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-fg-muted hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        dir="ltr"
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          const html = ref.current?.innerHTML || '';
          lastEmitted.current = html;
          onChange?.(html);
        }}
        onInput={(e) => emit(e.currentTarget.innerHTML)}
        className="prose-editor px-3 py-2.5 text-sm text-fg focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-fg-subtle"
        style={{ minHeight, direction: 'ltr', unicodeBidi: 'plaintext' }}
      />
    </div>
  );
}
