import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmptyState } from './EmptyState';

export function DataTable({
  columns,
  data,
  globalFilter,
  onRowClick,
  pageSize = 10,
  paginate = true,
  emptyTitle = 'No records',
  emptyMessage = 'There is nothing to show here yet.',
  className,
}) {
  const [sorting, setSorting] = useState([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: paginate ? getPaginationRowModel() : undefined,
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className={cn('w-full', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide whitespace-nowrap"
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    >
                      {header.isPlaceholder ? null : (
                        <button
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
            {rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                onKeyDown={(e) => {
                  if (!onRowClick) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row.original);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    e.currentTarget.parentElement?.children[rowIndex + 1]?.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    e.currentTarget.parentElement?.children[rowIndex - 1]?.focus();
                  }
                }}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                className={cn(
                  'border-b border-border/50 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-fg align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <EmptyState title={emptyTitle} message={emptyMessage} className="py-12" />}

      {paginate && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
          <span className="text-xs text-fg-subtle">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} ·{' '}
            {table.getFilteredRowModel().rows.length} records
          </span>
          <div className="flex items-center gap-1">
            {[
              [ChevronsLeft, () => table.setPageIndex(0), !table.getCanPreviousPage()],
              [ChevronLeft, () => table.previousPage(), !table.getCanPreviousPage()],
              [ChevronRight, () => table.nextPage(), !table.getCanNextPage()],
              [ChevronsRight, () => table.setPageIndex(table.getPageCount() - 1), !table.getCanNextPage()],
            ].map(([Icon, onClick, disabled], i) => (
              <button
                key={i}
                onClick={onClick}
                disabled={disabled}
                className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
