import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Debounced search input. Calls onChange 300ms after typing stops. */
export function SearchInput({ value = '', onChange, placeholder = 'Search…', className, delay = 300 }) {
  const [local, setLocal] = useState(value);
  const timer = useRef();

  useEffect(() => setLocal(value), [value]);

  const handle = (v) => {
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange?.(v), delay);
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle pointer-events-none" />
      <input
        value={local}
        onChange={(e) => handle(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 rounded-input bg-card border border-border pl-9 pr-9 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
      />
      {local && (
        <button
          onClick={() => handle('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
