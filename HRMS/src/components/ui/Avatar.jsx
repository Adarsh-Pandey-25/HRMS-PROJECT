import { cn, getInitials } from '../../lib/utils';

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
};

/** Accepts either an `employee` object (avatarUrl/name) or plain `name`/`src` props. */
export function Avatar({ employee, name, src, size = 'md', className, ring = false }) {
  const resolvedName = employee?.name || name || '';
  const resolvedSrc = employee?.avatarUrl || src;
  const initials = getInitials(resolvedName);
  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold overflow-hidden',
        resolvedSrc ? '' : 'bg-primary-light text-primary',
        ring && 'ring-2 ring-card',
        SIZES[size],
        className
      )}
      title={resolvedName}
    >
      {resolvedSrc ? (
        <img src={resolvedSrc} alt={resolvedName} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials || '?'
      )}
    </div>
  );
}

/** Overlapping avatar stack. */
export function AvatarGroup({ people = [], max = 4, size = 'sm' }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name || p} src={p.avatar} size={size} ring />
      ))}
      {extra > 0 && (
        <div
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-muted text-fg-muted font-semibold ring-2 ring-card',
            SIZES[size]
          )}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
