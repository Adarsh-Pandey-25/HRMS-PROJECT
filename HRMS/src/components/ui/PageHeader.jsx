import { cn } from '../../lib/utils';

export function PageHeader({ title, subtitle, actions, className, children }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-page-title text-fg truncate">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
