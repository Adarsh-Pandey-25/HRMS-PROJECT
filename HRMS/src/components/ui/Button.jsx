import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const VARIANTS = {
  primary:
    'bg-primary text-white hover:bg-primary-dark shadow-sm shadow-primary/30 disabled:bg-primary/50',
  secondary:
    'bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50',
  ghost:
    'text-fg-muted hover:bg-primary/10 hover:text-primary disabled:opacity-50',
  outline:
    'border border-border bg-card text-fg hover:bg-muted disabled:opacity-50',
  danger:
    'bg-danger text-white hover:bg-danger/90 shadow-sm shadow-danger/30 disabled:opacity-50',
  'danger-ghost':
    'text-danger hover:bg-danger/10 disabled:opacity-50',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, children, loading, icon: Icon, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-input font-medium',
        'transition-all duration-150 active:scale-95 select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        Icon && <Icon className={cn('h-4 w-4', size === 'sm' && 'h-3.5 w-3.5')} />
      )}
      {children}
    </button>
  );
});
