import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, User, CalendarOff, DollarSign, Ticket, Megaphone, Monitor, Receipt, BookOpen,
} from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { useGlobalSearchQuery, SEARCH_CATEGORY_LABELS } from '../../hooks/useGlobalSearch';
import { cn } from '../../lib/utils';

const CATEGORY_ICON = {
  employees: User, leaves: CalendarOff, payroll: DollarSign, tickets: Ticket,
  announcements: Megaphone, assets: Monitor, expenses: Receipt, courses: BookOpen,
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebounce(query, 300);
  const { data: results = {} } = useGlobalSearchQuery(debouncedQuery);
  const containerRef = useRef(null);

  // Flatten for keyboard navigation across category boundaries.
  const flatResults = useMemo(() => {
    const flat = [];
    Object.entries(results).forEach(([category, items]) => {
      items.forEach((item) => flat.push({ ...item, category }));
    });
    return flat;
  }, [results]);

  useEffect(() => {
    setIsOpen(Object.keys(results).length > 0);
    setActiveIndex(-1);
  }, [results]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const goToResult = (item) => {
    navigate(item.path);
    setIsOpen(false);
    setQuery('');
  };

  const viewAll = () => {
    navigate(`/search?q=${encodeURIComponent(query)}`);
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setIsOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    }
    if (e.key === 'Enter') {
      if (activeIndex >= 0 && flatResults[activeIndex]) goToResult(flatResults[activeIndex]);
      else if (query.trim().length >= 2) viewAll();
    }
  };

  const categories = Object.keys(results);
  let runningIndex = -1;

  return (
    <div className="relative flex-1 max-w-md hidden sm:block" ref={containerRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle pointer-events-none" />
      <input
        id="global-search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim().length >= 2 && Object.keys(results).length > 0 && setIsOpen(true)}
        placeholder="Search employees, leaves, tickets, announcements..."
        role="combobox"
        aria-expanded={isOpen}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-label="Global search"
        className="w-full h-10 rounded-input bg-muted border border-border pl-9 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:bg-card focus:border-primary focus:ring-2 focus:ring-primary/40 transition-all"
      />

      {isOpen && (
        <div id="global-search-results" role="listbox" aria-label="Search results" className="absolute top-full left-0 mt-2 w-[480px] max-w-[90vw] bg-card rounded-card shadow-card-hover border border-border z-50 max-h-[480px] overflow-y-auto animate-scale-in">
          {categories.map((category) => {
            const Icon = CATEGORY_ICON[category] || Search;
            return (
              <div key={category} className="border-b border-border/50 last:border-0">
                <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {SEARCH_CATEGORY_LABELS[category]}
                </p>
                {results[category].map((item) => {
                  runningIndex++;
                  const idx = runningIndex;
                  return (
                    <button
                      key={`${category}-${item.id}`}
                      role="option"
                      aria-selected={activeIndex === idx}
                      onClick={() => goToResult(item)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        'flex items-center gap-3 w-full text-left px-4 py-2.5 transition-colors',
                        activeIndex === idx ? 'bg-primary/10' : 'hover:bg-muted/60'
                      )}
                    >
                      <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg truncate">{item.title}</p>
                        <p className="text-xs text-fg-subtle truncate">{item.subtitle}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          <div className="px-4 py-3">
            <button onClick={viewAll} className="text-sm text-primary hover:underline">
              View all results for "{query}" →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
