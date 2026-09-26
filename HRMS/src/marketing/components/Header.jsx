import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { NAV_LINKS } from '../siteConfig';
import { Container, TrialButton } from './ui';
import { Logo } from './Logo';

/** No sign-in link on purpose: each company signs in at its own workspace address. */
export function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);

  const linkClass = ({ isActive }) => `text-sm font-medium transition-colors ${isActive ? 'text-brand-700' : 'text-slate-600 hover:text-ink'}`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Logo />
        <nav className="hidden md:flex items-center gap-7" aria-label="Main">
          {NAV_LINKS.map((l) => <NavLink key={l.to} to={l.to} className={linkClass}>{l.label}</NavLink>)}
        </nav>
        <div className="hidden md:block"><TrialButton label="Start free trial" /></div>
        <button
          type="button"
          className="md:hidden -mr-2 p-2 text-ink"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </Container>
      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white">
          <Container className="flex flex-col gap-4 py-4">
            {NAV_LINKS.map((l) => <NavLink key={l.to} to={l.to} className={linkClass}>{l.label}</NavLink>)}
            <TrialButton label="Start free trial" className="w-full" />
          </Container>
        </div>
      )}
    </header>
  );
}
