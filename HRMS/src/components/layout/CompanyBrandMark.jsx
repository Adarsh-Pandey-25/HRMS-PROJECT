import { cn } from '../../lib/utils';

export function CompanyBrandMark({ name, logoUrl, className, textClassName }) {
  const initial = name?.[0]?.toUpperCase() || 'H';

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name || 'Company'} logo`}
        className={cn('h-9 w-9 rounded-xl object-cover shrink-0 bg-card border border-border/60', className)}
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
