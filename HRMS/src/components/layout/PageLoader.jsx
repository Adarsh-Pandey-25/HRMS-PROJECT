/** Lightweight fallback — full skeletons felt laggy on every module switch. */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-3">
        <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-2/3 rounded-full bg-primary animate-pulse" />
        </div>
        <p className="text-xs text-fg-subtle">Loading…</p>
      </div>
    </div>
  );
}
