import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { demoHref } from '../siteConfig';

const cx = (...c) => c.filter(Boolean).join(' ');

export function Container({ className, children }) {
  return <div className={cx('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

export function Section({ id, className, children }) {
  return <section id={id} className={cx('py-16 sm:py-24', className)}><Container>{children}</Container></section>;
}

export function SectionHeading({ eyebrow, title, subtitle, align = 'center', tone = 'dark' }) {
  return (
    <div className={cx('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>}
      <h2 className={cx('mt-2 text-3xl sm:text-4xl font-semibold tracking-tight', tone === 'light' ? 'text-white' : 'text-ink')}>{title}</h2>
      {subtitle && <p className={cx('mt-4 text-base sm:text-lg', tone === 'light' ? 'text-slate-300' : 'text-slate-600')}>{subtitle}</p>}
    </div>
  );
}

const BUTTON = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-700',
  bright: 'bg-brand-400 text-ink hover:bg-brand-300 focus-visible:outline-brand-300',
  outline: 'border border-slate-300 text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-slate-400',
  ghostLight: 'border border-white/25 text-white hover:bg-white/10 focus-visible:outline-white',
};

const buttonClass = (variant, size) => cx(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
  size === 'lg' ? 'px-5 py-3 text-base' : 'px-4 py-2.5 text-sm',
  BUTTON[variant],
);

export function ButtonLink({ to, href, variant = 'primary', size = 'md', arrow, className, children, ...rest }) {
  const content = <>{children}{arrow && <ArrowRight className="h-4 w-4" aria-hidden="true" />}</>;
  if (href) return <a href={href} className={cx(buttonClass(variant, size), className)} {...rest}>{content}</a>;
  return <Link to={to} className={cx(buttonClass(variant, size), className)} {...rest}>{content}</Link>;
}

export function TrialButton({ variant = 'primary', size = 'md', label = 'Start your 7-day free trial', className }) {
  return <ButtonLink to="/start-trial" variant={variant} size={size} arrow className={className}>{label}</ButtonLink>;
}

export function DemoButton({ variant = 'outline', size = 'md', className }) {
  const href = demoHref();
  const external = href.startsWith('http');
  return (
    <ButtonLink href={href} variant={variant} size={size} className={className} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      Book a demo
    </ButtonLink>
  );
}
