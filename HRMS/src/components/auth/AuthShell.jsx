import { forwardRef, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Input } from '../ui';
import { cn } from '../../lib/utils';
import spaxsyncMark from '../../assets/brand/spaxsync-mark.svg';

/**
 * Premium sign-in layout shared by the company login pages and the
 * super-admin login: a brand panel beside the form on wide screens, folding
 * into a compact header above it on phones.
 *
 * Everything accented is drawn from the `primary` theme colour. On a tenant
 * host useApplyBrandColor sets that to the company's own brand colour, so
 * each company's login wears its own brand with no per-tenant styling here.
 */

/** The company's mark: its uploaded logo on a white tile (uploaded logos are
 *  often dark-on-transparent and would vanish on the dark panel), else its
 *  initial on a primary tile. */
function BrandMark({ logoUrl, name, size = 'md' }) {
  const box = size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';
  if (logoUrl) {
    return (
      <div className={cn(box, 'shrink-0 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-black/5 flex items-center justify-center')}>
        <img src={logoUrl} alt={`${name || 'Company'} logo`} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={cn(box, 'shrink-0 rounded-2xl bg-primary text-on-primary shadow-lg flex items-center justify-center')}>
      <span className={cn('font-bold leading-none', size === 'lg' ? 'text-2xl' : 'text-lg')}>
        {(name?.[0] || 'S').toUpperCase()}
      </span>
    </div>
  );
}

export function AuthShell({
  brandName, logoUrl, markSrc, eyebrow, headline, subline, highlights = [], children,
}) {
  const mark = markSrc
    ? <img src={markSrc} alt="" className="h-10 w-10 shrink-0 rounded-xl shadow-lg" />
    : <BrandMark logoUrl={logoUrl} name={brandName} />;

  return (
    <div className="min-h-screen bg-page lg:grid lg:grid-cols-[minmax(0,46%)_minmax(0,1fr)]">
      {/* ── Brand panel (wide screens) ─────────────────────────────────── */}
      {/* The hairline edge only shows in dark mode, where the page background
          is the same ink as this panel and the two halves would otherwise merge. */}
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:border-r lg:border-white/10 lg:p-12 xl:p-16">
        {/* Brand-coloured glows and a faint dot grid — depth without an image. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: [
              'radial-gradient(60% 50% at 12% 8%, rgb(var(--color-primary) / 0.45), transparent 70%)',
              'radial-gradient(50% 45% at 95% 100%, rgb(var(--color-primary) / 0.28), transparent 70%)',
            ].join(','),
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'linear-gradient(to bottom, black 30%, transparent 95%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 30%, transparent 95%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          {mark}
          <span className="text-lg font-semibold tracking-tight">{brandName}</span>
        </div>

        <div className="relative max-w-md motion-safe:animate-rise-in">
          {eyebrow && (
            <span className="inline-flex items-center rounded-pill border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              {eyebrow}
            </span>
          )}
          <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-tight xl:text-[44px]">{headline}</h2>
          {subline && <p className="mt-4 text-base leading-relaxed text-white/65">{subline}</p>}
          {highlights.length > 0 && (
            <ul className="mt-9 space-y-4">
              {highlights.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-white/80">
                  {/* White on a brand tint, not brand on dark: many brand
                      colours (the default teal-700 among them) are too dark
                      to read on this panel. */}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/25 ring-1 ring-inset ring-white/10">
                    <Icon className="h-4 w-4 text-white" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <PoweredBy tone="dark" />
      </aside>

      {/* ── Form column ────────────────────────────────────────────────── */}
      <main className="relative flex min-h-screen flex-col px-5 py-8 sm:px-8 lg:min-h-0">

        {/* Compact brand header — the panel's stand-in on phones. */}
        <div className="relative flex items-center gap-3 lg:hidden">
          {markSrc
            ? <img src={markSrc} alt="" className="h-9 w-9 rounded-xl" />
            : <BrandMark logoUrl={logoUrl} name={brandName} />}
          <span className="text-base font-semibold tracking-tight text-fg">{brandName}</span>
        </div>

        <div className="relative flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] motion-safe:animate-rise-in">{children}</div>
        </div>

        <div className="relative flex justify-center lg:hidden"><PoweredBy tone="light" /></div>
      </main>
    </div>
  );
}

function PoweredBy({ tone }) {
  return (
    <a
      href="https://spaxsync.com"
      className={cn(
        'relative inline-flex items-center gap-2 text-xs transition-colors',
        tone === 'dark' ? 'text-white/45 hover:text-white/80' : 'text-fg-subtle hover:text-fg-muted',
      )}
    >
      <img src={spaxsyncMark} alt="" className="h-4 w-4 rounded" />
      Powered by <span className="font-semibold">SpaxSync</span>
    </a>
  );
}

/** Heading block at the top of the form. */
export function AuthHeading({ badge, title, subtitle }) {
  return (
    <div className="mb-7">
      {badge && (
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {badge}
        </span>
      )}
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{subtitle}</p>}
    </div>
  );
}

/** Password field with a show/hide toggle. Forwards its ref so
 *  react-hook-form's register() works exactly as on a plain Input. */
export const PasswordInput = forwardRef(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      ref={ref}
      type={visible ? 'text' : 'password'}
      icon={Lock}
      trailing={(
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
      {...props}
    />
  );
});

/** Large, spaced one-time-code field for the 2FA step. */
export const CodeInput = forwardRef(function CodeInput({ className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="••••••"
      className={cn('h-14 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]', className)}
      {...props}
    />
  );
});
