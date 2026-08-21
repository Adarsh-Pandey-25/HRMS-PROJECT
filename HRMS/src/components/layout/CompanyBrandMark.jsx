import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useCompanyStore } from '../../store/companyStore';

export function CompanyBrandMark({ name, logoUrl, className, textClassName }) {
  const initial = name?.[0]?.toUpperCase() || 'H';
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [logoUrl]);

  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt={`${name || 'Company'} logo`}
        onError={() => setBroken(true)}
        className={cn('h-9 w-9 rounded-xl object-contain shrink-0 bg-card', className)}
      />
    );
  }

  return (
    <div className={cn(
      'h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shrink-0',
      className,
    )}
    >
      <span className={cn('text-white font-bold text-lg leading-none', textClassName)}>{initial}</span>
    </div>
  );
}

/** Sidebar lockup: full wordmark when expanded; compact brand icon when collapsed. */
export function SidebarBrand({ collapsed = false, to = '/dashboard', onClick }) {
  const companyName = useCompanyStore((s) => s.company.name);
  const logoUrl = useCompanyStore((s) => s.company.logoUrl);
  const brandIconUrl = useCompanyStore((s) => s.company.brandIconUrl);
  const [wordmarkBroken, setWordmarkBroken] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);

  useEffect(() => {
    setWordmarkBroken(false);
  }, [logoUrl]);

  useEffect(() => {
    setIconBroken(false);
  }, [brandIconUrl]);

  const compactUrl = brandIconUrl || null;
  const showWordmark = Boolean(logoUrl) && !wordmarkBroken && !collapsed;
  const showCompactIcon = collapsed && Boolean(compactUrl) && !iconBroken;

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 min-h-16 py-3 px-4 shrink-0 hover:opacity-90 transition-opacity',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
        collapsed && 'justify-center px-2',
      )}
      title={companyName || 'Go to Dashboard'}
    >
      {showWordmark ? (
        <img
          src={logoUrl}
          alt={companyName || 'Company'}
          onError={() => setWordmarkBroken(true)}
          className="h-8 w-auto max-w-[200px] object-contain object-left"
        />
      ) : showCompactIcon ? (
        <img
          src={compactUrl}
          alt={companyName || 'Company'}
          onError={() => setIconBroken(true)}
          className="h-9 w-9 rounded-xl object-contain bg-card"
        />
      ) : (
        <>
          <CompanyBrandMark name={companyName} logoUrl={null} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg leading-snug break-words">{companyName}</p>
              <p className="text-[10px] text-fg-subtle leading-tight mt-0.5">HR Suite</p>
            </div>
          )}
        </>
      )}
    </Link>
  );
}
