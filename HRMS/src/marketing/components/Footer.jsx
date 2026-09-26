import { Link } from 'react-router-dom';
import { SITE, FOOTER_GROUPS } from '../siteConfig';
import { Container } from './ui';
import { Logo } from './Logo';

const YEAR = 2026;

export function Footer() {
  return (
    <footer className="bg-ink text-slate-400">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo tone="light" />
            <p className="mt-4 text-sm leading-relaxed">{SITE.tagline}.</p>
            <p className="mt-4 text-sm">
              <a href={`mailto:${SITE.supportEmail}`} className="hover:text-white">{SITE.supportEmail}</a>
              {SITE.phone && <><br /><a href={`tel:${SITE.phone.replace(/\s/g, '')}`} className="hover:text-white">{SITE.phone}</a></>}
            </p>
          </div>
          {FOOTER_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-sm font-semibold text-white">{group.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {group.links.map((l) => <li key={l.to}><Link to={l.to} className="hover:text-white">{l.label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© {YEAR} {SITE.legalName}. All rights reserved.</p>
          {(SITE.gstin || SITE.address) && (
            <p>
              {SITE.gstin && <>GSTIN: {SITE.gstin}</>}
              {SITE.address && <span className="block sm:inline sm:ml-3">{SITE.address}</span>}
            </p>
          )}
        </div>
      </Container>
    </footer>
  );
}
