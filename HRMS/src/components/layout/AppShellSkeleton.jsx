import { Skeleton } from '../ui';

/** App chrome skeleton — feels faster than a blank full-screen spinner on reload. */
export function AppShellSkeleton({ children }) {
  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar p-4 gap-2">
        <Skeleton className="h-9 w-36 mb-2" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-xl" />
        ))}
      </aside>
      <div className="flex flex-1 flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-border px-4 sm:px-6 flex items-center gap-3">
          <Skeleton className="h-10 flex-1 max-w-md rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl ml-auto" />
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
