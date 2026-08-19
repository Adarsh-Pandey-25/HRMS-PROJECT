/** Invisible fallback so route/session waits don't flash a spinner. */
export function PageLoader() {
  return (
    <div className="min-h-[24vh]" role="status" aria-live="polite" aria-label="Loading">
      <span className="sr-only">Loading</span>
    </div>
  );
}
