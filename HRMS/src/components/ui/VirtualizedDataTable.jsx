import { useRef, useState, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmptyState } from './EmptyState';

const ROW_HEIGHT = 52;

/**
 * Virtualized table for large datasets — only visible rows are mounted in the DOM
 * for smooth scrolling on directories with hundreds of employees.
 */
export function VirtualizedDataTable({
  columns,
  data,
  globalFilter,
  onRowClick,
  emptyTitle = 'No records',
  emptyMessage = 'There is nothing to show here yet.',
  className,
  maxHeight = 560,
}) {
  const parentRef = useRef(null);
  const [sorting, setSorting] = useState([]);
  const [scrollReady, setScrollReady] = useState(false);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  useLayoutEffect(() => {
    setScrollReady(Boolean(parentRef.current));
    virtualizer.measure();
  }, [rows.length, data, sorting, globalFilter, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const headerGroups = table.getHeaderGroups();
  const useFallbackRows = rows.length > 0 && (!scrollReady || virtualRows.length === 0);

  if (rows.length === 0) {
    return (
      <div className={cn('w-full', className)}>
        <EmptyState title={emptyTitle} message={emptyMessage} className="py-12" />
      </div>
    );
  }

  const renderRow = (row, style = {}) => (
    <tr
      key={row.id}
      style={style}
      onClick={() => onRowClick?.(row.original)}
      className={cn(
        'border-b border-border/50 transition-colors',
        onRowClick && 'cursor-pointer hover:bg-primary/5'
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-4 py-3 text-fg align-middle">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

  return (
    <div className={cn('w-full', className)}>
      <div ref={parentRef} className="overflow-auto scroll-smooth-gpu" style={{ maxHeight }}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            {headerGroups.map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide whitespace-nowrap bg-card"
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={cn('inline-flex items-center gap-1', canSort && 'cursor-pointer hover:text-fg')}
                          onClick={header.column.getToggleSortingHandler()}
                          disabled={!canSort}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span className="flex flex-col -space-y-1">
                              <ChevronUp className={cn('h-3 w-3', sorted === 'asc' ? 'text-primary' : 'text-fg-subtle/40')} />
                              <ChevronDown className={cn('h-3 w-3', sorted === 'desc' ? 'text-primary' : 'text-fg-subtle/40')} />
                            </span>
                          )}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {useFallbackRows
              ? rows.map((row) => renderRow(row))
              : (
                <>
                  {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                    <tr aria-hidden style={{ height: virtualRows[0].start }}><td colSpan={columns.length} /></tr>
                  )}
                  {virtualRows.map((vRow) => {
                    const row = rows[vRow.index];
                    return renderRow(row, { height: ROW_HEIGHT });
                  })}
                  {virtualRows.length > 0 && totalSize - virtualRows[virtualRows.length - 1].end > 0 && (
                    <tr aria-hidden style={{ height: totalSize - virtualRows[virtualRows.length - 1].end }}>
                      <td colSpan={columns.length} />
                    </tr>
                  )}
                </>
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
