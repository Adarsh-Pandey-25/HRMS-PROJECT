import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { PageHeader, Card, EmptyState, Skeleton, SearchInput } from '../../components/ui';
import { useKbCategories, useKbArticles } from '../../hooks/useModules';
import { humanize } from '../../lib/utils';

export default function KnowledgeBase() {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const { data: categories = [], isLoading: loadingCats } = useKbCategories();
  const { data: articles = [], isLoading: loadingArticles } = useKbArticles(category || undefined);

  const filtered = articles.filter((a) =>
    !search || (a.title || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Knowledge Base" subtitle="Self-service articles for common IT and HR questions" />

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search articles…" className="flex-1" icon={Search} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory('')}
            className={`rounded-pill px-3 py-1.5 text-xs font-medium border ${!category ? 'bg-primary/10 border-primary text-primary' : 'border-border text-fg-muted'}`}
          >
            All
          </button>
          {(categories || []).map((c) => (
            <button
              key={c.id || c}
              type="button"
              onClick={() => setCategory(c.id || c)}
              className={`rounded-pill px-3 py-1.5 text-xs font-medium border ${category === (c.id || c) ? 'bg-primary/10 border-primary text-primary' : 'border-border text-fg-muted'}`}
            >
              {humanize(c.name || c)}
            </button>
          ))}
        </div>
      </div>

      {loadingCats || loadingArticles ? (
        <Skeleton className="h-48 rounded-card" />
      ) : filtered.length === 0 ? (
        <Card className="py-8"><EmptyState icon={BookOpen} title="No articles" message="Try a different search or category." /></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const cat = categories.find((c) => (c.id || c) === a.category);
            return (
              <Card key={a.id} className="p-4 hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-fg">{a.title}</p>
                  {cat?.name && (
                    <span className="shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                      {humanize(cat.name)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-fg-muted mt-2 leading-relaxed">{a.content || a.body || ''}</p>
                {(a.views > 0 || a.updated_on || a.updatedOn) && (
                  <p className="text-xs text-fg-subtle mt-3">
                    {a.views > 0 && `${a.views} views`}
                    {a.views > 0 && (a.updated_on || a.updatedOn) && ' · '}
                    {(a.updated_on || a.updatedOn) && `Updated ${a.updated_on || a.updatedOn}`}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
