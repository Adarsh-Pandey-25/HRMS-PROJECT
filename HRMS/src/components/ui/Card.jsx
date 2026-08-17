import { cn } from '../../lib/utils';

export function Card({ className, hover = false, ...props }) {
  return (
    <div
      className={cn(
        'rounded-card bg-card shadow-card border border-border/60',
        hover && 'transition-shadow hover:shadow-card-hover',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, title, subtitle, action, children }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div className="min-w-0">
        {title && <h3 className="text-base font-semibold text-fg truncate">{title}</h3>}
        {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn('px-5 py-4 border-t border-border/60 flex items-center gap-3', className)}
      {...props}
    />
  );
}
