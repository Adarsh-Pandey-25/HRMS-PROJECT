import { forwardRef, useState } from 'react';
import { useController } from 'react-hook-form';
import { ChevronDown } from 'lucide-react';
import { Field } from './Input';
import { cn } from '../../lib/utils';
import { COUNTRY_GROUPS, composePhone, countryByIso, parsePhone, splitPhone } from '../../lib/phone';

/**
 * A phone number with its country code: a country picker (India first,
 * then the most used countries, then every country A–Z) and the number.
 *
 * `value` and `onChange` carry the number the way it is kept
 * (lib/phone.js): "9876543210" for India, exactly as before, and
 * "+971501234567" for anywhere else. Pasting a whole number with its
 * country code ("+971 50 123 4567") picks the country too.
 */
export const PhoneInput = forwardRef(function PhoneInput(
  {
    label, error, hint, required, className, containerClass, value, onChange, onBlur, name, id, disabled,
    placeholder, autoComplete = 'tel-national',
  },
  ref,
) {
  const current = value ?? '';
  // What the picker and the box show, and the value they stand for.
  const [shown, setShown] = useState(() => ({ ...splitPhone(current), value: current }));
  if (current !== shown.value) {
    // Changed from outside (the record loaded, or the form was reset).
    setShown({ ...splitPhone(current, shown.iso), value: current });
  }
  const country = countryByIso(shown.iso);
  const india = country.iso === 'IN';

  const change = (iso, number) => {
    const next = composePhone(iso, number);
    setShown({ iso, number, value: next });
    onChange?.(next);
  };

  const onNumberChange = (e) => {
    const typed = e.target.value;
    // A number pasted with its country code ("+971 50 123 4567") picks the country too.
    const pasted = typed.includes('+') ? parsePhone(typed) : null;
    if (pasted?.number) {
      change(pasted.country.dial === country.dial ? country.iso : pasted.country.iso, pasted.number);
      return;
    }
    const digits = typed.replace(/\D/g, '').slice(0, 15);
    // India as before; "098765 43210" or "91 98765 43210" pasted become the 10 digits.
    change(shown.iso, india && digits ? parsePhone(digits).number : digits);
  };

  const control = (
    <div
      className={cn(
        'flex h-10 w-full rounded-input border border-border bg-card transition-colors',
        'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary',
        error && 'border-danger focus-within:border-danger focus-within:ring-danger',
        disabled && 'opacity-60',
        className,
      )}
    >
      <div className="relative flex shrink-0 items-center border-r border-border">
        <span aria-hidden="true" className="flex min-w-[4.25rem] items-center justify-between gap-1 pl-3 pr-2 text-sm text-fg">
          +{country.dial}
          <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />
        </span>
        {/* The real picker, invisible over the code: the device's own list, with names. */}
        <select
          aria-label="Country code"
          title={country.name}
          value={shown.iso}
          disabled={disabled}
          onChange={(e) => change(e.target.value, shown.number)}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-card text-sm text-fg opacity-0 disabled:cursor-not-allowed"
        >
          {COUNTRY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.countries.map((c) => (
                <option key={`${group.label}-${c.iso}`} value={c.iso}>{`${c.name} (+${c.dial})`}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <input
        ref={ref}
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        value={shown.number}
        disabled={disabled}
        placeholder={placeholder ?? (india ? 'e.g. 9876543210' : 'Mobile number')}
        aria-invalid={error ? 'true' : undefined}
        onChange={onNumberChange}
        onBlur={onBlur}
        className="h-full min-w-0 flex-1 rounded-r-input bg-transparent px-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
  if (!label && !error && !hint) return control;
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClass}>
      {control}
    </Field>
  );
});

/** PhoneInput for a react-hook-form field: `control` and `name` from the form. */
export function FormPhoneInput({ control, name, ...props }) {
  const { field } = useController({ control, name });
  return (
    <PhoneInput
      {...props}
      ref={field.ref}
      name={field.name}
      value={field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
    />
  );
}
