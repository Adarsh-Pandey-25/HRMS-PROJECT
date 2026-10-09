import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * Small building blocks for Settings → Payroll: rule cards written as plain
 * sentences with the numbers editable in place.
 */

/** A rule card: icon bubble, title, one-line summary, optional switch, body. */
export function RuleCard({ icon: Icon, tone = 'primary', title, summary, right, children, className, muted = false }) {
  const tones = {
    primary: 'from-primary/20 to-primary/5 text-primary',
    amber: 'from-warning/25 to-warning/5 text-warning',
    rose: 'from-danger/20 to-danger/5 text-danger',
    sky: 'from-info/20 to-info/5 text-info',
    violet: 'from-violet-500/20 to-violet-500/5 text-violet-500',
    teal: 'from-teal/25 to-teal/5 text-teal',
  };
  return (
    <section
      className={cn(
        'group relative overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-card transition-all duration-300',
        'hover:-translate-y-0.5 hover:shadow-card-hover',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        {Icon && (
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br', tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
              {summary && <p className="mt-0.5 text-xs text-fg-subtle">{summary}</p>}
            </div>
            {right}
          </div>
          {children && (
            <div className={cn('mt-4 transition-opacity', muted && 'pointer-events-none opacity-40')}>
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A number you edit inside a sentence. Commits on blur / Enter, never mid-typing. */
export function NumberChip({
  value, onCommit, min = 0, max = 999, step = 1, suffix, prefix, width = 'w-14', ariaLabel, disabled,
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  const commit = (raw) => {
    const n = Number(raw);
    const next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const bump = (dir) => commit(Number(value || 0) + dir * step);
  return (
    <span className={cn('mx-0.5 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 align-middle', disabled && 'opacity-50')}>
      <button type="button" disabled={disabled} onClick={() => bump(-1)} aria-label={`Decrease ${ariaLabel || ''}`} className="rounded-full p-1 text-primary hover:bg-primary/15">
        <Minus className="h-3 w-3" />
      </button>
      {prefix && <span className="text-xs font-semibold text-primary">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={cn('bg-transparent text-center text-sm font-bold tabular-nums text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', width)}
      />
      {suffix && <span className="pr-1 text-xs font-semibold text-primary">{suffix}</span>}
      <button type="button" disabled={disabled} onClick={() => bump(1)} aria-label={`Increase ${ariaLabel || ''}`} className="rounded-full p-1 text-primary hover:bg-primary/15">
        <Plus className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Pill options — one is chosen. */
export function PillGroup({ options, value, onChange, size = 'md', className, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex flex-wrap gap-1 rounded-2xl bg-muted/70 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl font-semibold transition-all duration-200',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs',
              active ? 'bg-card text-primary shadow-sm ring-1 ring-primary/20' : 'text-fg-muted hover:text-fg',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A big friendly on/off switch with a word on it. */
export function Switch({ checked, onChange, label = ['Off', 'On'], disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-[58px] shrink-0 items-center rounded-full transition-colors duration-300',
        checked ? 'bg-primary' : 'bg-muted ring-1 ring-inset ring-border',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={cn('absolute text-[10px] font-bold uppercase tracking-wide transition-all', checked ? 'left-2 text-on-primary' : 'right-2 text-fg-subtle')}>
        {checked ? label[1] : label[0]}
      </span>
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300',
          checked ? 'translate-x-[34px]' : 'translate-x-1',
        )}
      />
    </button>
  );
}

/** A sentence line in a rule card. */
export function Sentence({ children, className }) {
  // A div, not a <p>: sentences hold pill groups, which are block elements.
  return <div className={cn('text-sm leading-8 text-fg-muted', className)}>{children}</div>;
}

/** A little stat tag. */
export function Tag({ children, tone = 'neutral', className }) {
  const tones = {
    neutral: 'bg-muted text-fg-muted',
    primary: 'bg-primary/10 text-primary',
    good: 'bg-success/10 text-success',
    warn: 'bg-warning/15 text-warning',
    bad: 'bg-danger/10 text-danger',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', tones[tone], className)}>{children}</span>;
}
