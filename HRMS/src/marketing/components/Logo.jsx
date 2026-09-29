import { Link } from 'react-router-dom';
import { SITE } from '../siteConfig';
import spaxsyncMark from '../../assets/brand/spaxsync-mark.svg';

/**
 * The SpaxSync brand mark. Its own white-to-bronze badge background carries
 * on both light and dark surfaces, so unlike the old inline mark this one
 * needs no `tone` variant of its own.
 */
export function LogoMark({ className = 'h-8 w-8' }) {
  return <img src={spaxsyncMark} alt="" className={className} />;
}

export function Logo({ tone = 'dark' }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label={`${SITE.name} home`}>
      <LogoMark />
      <span className={`text-lg font-semibold tracking-tight ${tone === 'light' ? 'text-white' : 'text-ink'}`}>{SITE.name}</span>
    </Link>
  );
}
