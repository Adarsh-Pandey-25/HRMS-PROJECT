import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { useDropdown, handleMenuArrowKeys } from '../../hooks/useDropdown';
import { exportData, EXPORT_FORMATS } from '../../lib/export';
import { useCompanyStore } from '../../store/companyStore';
import { cn } from '../../lib/utils';

const FORMAT_ICONS = {
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  pdf: FileText,
};

export function ExportButton({
  rows,
  filename = 'export',
  columns,
  title,
  sheets,
  formats = EXPORT_FORMATS,
  variant = 'outline',
  size = 'sm',
  label = 'Export',
  showLabel = true,
  disabled = false,
  loading = false,
  className,
  onExported,
  onExport,
  emptyMessage = 'Nothing to export',
  companyName: companyNameProp,
  subtitle,
}) {
  const { open, setOpen, close, containerRef, triggerRef } = useDropdown();
  const storeCompanyName = useCompanyStore((s) => s.company.name);
  const companyName = companyNameProp ?? storeCompanyName;

  const runExport = async (format) => {
    close();
    if (onExport) {
      try {
        const ok = await onExport(format.id);
        if (ok === false) {
          toast.error(emptyMessage);
          return;
        }
        toast.success(`Exported as ${format.label}`);
        onExported?.(format.id);
      } catch (err) {
        toast.error(err.message || 'Export failed');
      }
      return;
    }
    const ok = exportData({
      format: format.id,
      rows,
      filename,
      columns,
      title,
      sheets,
      companyName,
      subtitle,
    });
    if (!ok) {
      toast.error(emptyMessage);
      return;
    }
    toast.success(`Exported as ${format.label}`);
    onExported?.(format.id);
  };

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        icon={Download}
        disabled={disabled || loading}
        loading={loading}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="gap-1"
      >
        {showLabel && label}
        <ChevronDown className={cn('h-3.5 w-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div
          role="menu"
          onKeyDown={(e) => handleMenuArrowKeys(e, containerRef)}
          className="absolute right-0 z-50 mt-1.5 min-w-[10rem] rounded-card border border-border bg-card p-1 shadow-card-hover animate-scale-in"
        >
          {formats.map((format, idx) => {
            const Icon = FORMAT_ICONS[format.id] || Download;
            return (
              <button
                key={format.id}
                type="button"
                role="menuitem"
                tabIndex={idx === 0 ? 0 : -1}
                autoFocus={idx === 0}
                onClick={() => runExport(format)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <Icon className="h-4 w-4 shrink-0" />
                {format.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
