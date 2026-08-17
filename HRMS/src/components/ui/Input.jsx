import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export function Field({ label, error, hint, required, className, children }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-xs font-medium text-fg-muted">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : (
        hint && <span className="text-xs text-fg-subtle">{hint}</span>
      )}
    </div>
  );
}

const baseInput =
  'w-full rounded-input bg-card border border-border px-3 text-sm text-fg placeholder:text-fg-subtle ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export const Input = forwardRef(function Input(
  { label, error, hint, required, className, containerClass, icon: Icon, ...props },
  ref
) {
  const input = (
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle pointer-events-none" />
      )}
      <input
        ref={ref}
        className={cn(baseInput, 'h-10', Icon && 'pl-9', error && 'border-danger focus:ring-danger', className)}
        {...props}
      />
    </div>
  );
  if (!label && !error && !hint) return input;
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClass}>
      {input}
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, error, hint, required, className, containerClass, rows = 3, ...props },
  ref
) {
  const el = (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(baseInput, 'py-2 resize-none', error && 'border-danger focus:ring-danger', className)}
      {...props}
    />
  );
  if (!label && !error && !hint) return el;
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClass}>
      {el}
    </Field>
  );
});

export const Select = forwardRef(function Select(
  { label, error, hint, required, className, containerClass, options = [], placeholder, children, ...props },
  ref
) {
  const el = (
    <select
      ref={ref}
      className={cn(baseInput, 'h-10 appearance-none pr-8 cursor-pointer', error && 'border-danger', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.6rem center',
        backgroundSize: '1rem',
      }}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        )
      )}
      {children}
    </select>
  );
  if (!label && !error && !hint) return el;
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClass}>
      {el}
    </Field>
  );
});
