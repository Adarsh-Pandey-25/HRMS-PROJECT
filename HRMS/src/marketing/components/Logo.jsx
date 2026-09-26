import { Link } from 'react-router-dom';
import { SITE } from '../siteConfig';

/** Same mark as src/assets/brand/spaxsync-mark.svg, inlined so it paints with the HTML. */
export function LogoMark({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0B1220" />
      <path d="M44 17H27.5a7.5 7.5 0 0 0 0 15h9a7.5 7.5 0 0 1 0 15H20" fill="none" stroke="#2DD4BF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="44" cy="17" r="3.4" fill="#F59E0B" />
    </svg>
  );
}

export function Logo({ tone = 'dark' }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label={`${SITE.name} home`}>
      <LogoMark />
      <span className={`text-lg font-semibold tracking-tight ${tone === 'light' ? 'text-white' : 'text-ink'}`}>{SITE.name}</span>
    </Link>
  );
}
