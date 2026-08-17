import { cn } from '../../lib/utils';

export function Skeleton({ className }) {
  return <div className={cn('shimmer rounded-md bg-muted', className)} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-card bg-card shadow-card border border-border/60 p-5">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3 mt-3" />
      <Skeleton className="h-3 w-1/2 mt-3" />
    </div>
  );
}

export function SkeletonTable({ rows = 6 }) {
  return (
    <div className="rounded-card bg-card shadow-card border border-border/60 p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
