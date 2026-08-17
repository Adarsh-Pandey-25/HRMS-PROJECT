import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, User, Megaphone } from 'lucide-react';
import { PageHeader, Card, EmptyState, Skeleton } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import { useGlobalSearchQuery, SEARCH_CATEGORY_LABELS } from '../hooks/useGlobalSearch';
import { cn } from '../lib/utils';

const CATEGORY_ICON = {
  employees: User,
  announcements: Megaphone,
};

export default function SearchResults() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const debounced = useDebounce(query, 300);
  const { data: results = {}, isLoading, isFetching } = useGlobalSearchQuery(debounced);

  useEffect(() => {
    const q = debounced.trim();
    if (q) setParams({ q }, { replace: true });
    else setParams({}, { replace: true });
  }, [debounced, setParams]);

  const categories = Object.keys(results);
  const total = categories.reduce((n, k) => n + (results[k]?.length || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <PageHeader title="Search" subtitle="Find employees, announcements, and more" />

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-11 w-full rounded-xl border border-border bg-muted/50 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
        </div>
      </Card>

      {debounced.trim().length < 2 ? (
        <Card className="py-10"><EmptyState icon={Search} title="Type to search" message="Enter at least 2 characters." /></Card>
      ) : isLoading || isFetching ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : total === 0 ? (
        <Card className="py-10"><EmptyState icon={Search} title="No results" message={`Nothing matched "${debounced}".`} /></Card>
      ) : (
        categories.map((category) => {
          const Icon = CATEGORY_ICON[category] || Search;
          return (
            <Card key={category} className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle mb-3">
                {SEARCH_CATEGORY_LABELS[category] || category}
              </p>
              <div className="space-y-1">
                {results[category].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className={cn('flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-muted/60 transition-colors')}
                  >
                    <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate">{item.title}</p>
                      {item.subtitle && <p className="text-xs text-fg-subtle truncate">{item.subtitle}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
