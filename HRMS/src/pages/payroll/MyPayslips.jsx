import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, Card, Button, Skeleton } from '../../components/ui';
import { PayslipDocument } from '../../components/payroll/PayslipDocument';
import { useMyPayslips, downloadPayslipApi } from '../../hooks/usePayroll';
import { useCompanyStore } from '../../store/companyStore';
import { useAuthStore } from '../../store/authStore';
import { formatCompactINR, formatDate, cn } from '../../lib/utils';
import toast from 'react-hot-toast';

function monthKey(p) {
  if (!p) return '';
  if (String(p.month || '').includes('-')) return `${p.month}-01`;
  return `${p.year}-${String(p.monthNum || p.month || 1).padStart(2, '0')}-01`;
}

export default function MyPayslips() {
  const { data: payslips = [], isLoading } = useMyPayslips();
  const [selectedId, setSelectedId] = useState(null);
  const payslip = useMemo(
    () => payslips.find((p) => p.id === selectedId) || payslips[0] || null,
    [payslips, selectedId]
  );
  const company = useCompanyStore((s) => s.company);
  const user = useAuthStore((s) => s.user);

  const handleDownload = async () => {
    if (!payslip?.id) return toast.error('No payslip to download');
    try {
      await downloadPayslipApi(payslip.id);
    } catch (err) {
      toast.error(err.message || 'Failed to download payslip');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My Payslips" subtitle="View and download your monthly payslips" />

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : payslips.length === 0 ? (
        <Card className="p-8 text-center text-sm text-fg-subtle">No published payslips yet. Payslips appear here after HR publishes them.</Card>
      ) : (
        <div className="space-y-0">
          <div className="flex flex-wrap gap-0">
            {payslips.map((p) => {
              const active = (selectedId || payslips[0]?.id) === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium',
                    active
                      ? 'border-black bg-white text-black'
                      : 'border-slate-600 bg-slate-600 text-white hover:bg-slate-500'
                  )}
                >
                  {formatDate(monthKey(p), 'MMM yy')}
                  <span className="ml-2 text-xs opacity-80">{formatCompactINR(p.netPay)}</span>
                </button>
              );
            })}
          </div>

          {payslip && (
            <div className="border border-black bg-white p-3 sm:p-4">
              <div className="mb-3 flex justify-end">
                <Button variant="outline" icon={Download} onClick={handleDownload}>Download PDF</Button>
              </div>
              <PayslipDocument
                payslip={payslip}
                company={company}
                employee={user}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
