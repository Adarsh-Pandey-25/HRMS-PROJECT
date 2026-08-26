import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal, Plus, Paperclip, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, CardHeader, Button, StatusBadge, DataTable, Skeleton } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { useMyReimbursements, useReimbursementMutations } from '../../hooks/useReimbursements';
import { openReceiptApi } from '../../api/reimbursements.api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { CAT_ICON } from './catIcons';

export default function MyClaims() {
  const userId = useAuthStore((s) => s.user?.id);
  const { data: expenses = [], isLoading } = useMyReimbursements();
  const { withdraw } = useReimbursementMutations();
  const mine = expenses.filter((e) => !userId || e.employeeId === userId);

  const onWithdraw = async (id) => {
    if (!window.confirm('Withdraw this pending claim? This cannot be undone.')) return;
    try {
      await withdraw.mutateAsync(id);
      toast.success('Claim withdrawn');
    } catch (err) {
      toast.error(err.message || 'Could not withdraw claim');
    }
  };

  const summary = useMemo(() => ({
    pending: mine.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0),
    approved: mine.filter((e) => ['approved', 'paid'].includes(e.status)).reduce((s, e) => s + e.amount, 0),
    rejected: mine.filter((e) => e.status === 'rejected').length,
  }), [mine]);

  const columns = [
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue()) },
    {
      accessorKey: 'category', header: 'Category',
      cell: ({ getValue }) => {
        const Icon = CAT_ICON[getValue()] || MoreHorizontal;
        return <span className="inline-flex items-center gap-2 capitalize"><Icon className="h-4 w-4 text-fg-subtle" /> {getValue()}</span>;
      },
    },
    { accessorKey: 'description', header: 'Description' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => <span className="font-medium">{formatCurrency(getValue())}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    {
      id: 'receipt',
      header: 'Receipt',
      cell: ({ row }) => (
        row.original.receiptUrl ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Paperclip}
            onClick={async () => {
              try {
                await openReceiptApi(row.original.id);
              } catch (err) {
                toast.error(err.message || 'Could not open receipt');
              }
            }}
          >
            View
          </Button>
        ) : <span className="text-xs text-fg-subtle">—</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        row.original.status === 'pending' ? (
          <Button
            size="sm"
            variant="danger-ghost"
            icon={X}
            loading={withdraw.isPending}
            disabled={withdraw.isPending}
            onClick={() => onWithdraw(row.original.id)}
          >
            Withdraw
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Claims"
        subtitle="Submit and track your reimbursements"
        actions={<Link to="/expenses/submit"><Button icon={Plus}>Claim Expense</Button></Link>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <p className="text-xs text-fg-subtle">Pending reimbursement</p>
          <p className="text-2xl font-semibold text-warning mt-2">{formatCurrency(summary.pending)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-fg-subtle">Approved this month</p>
          <p className="text-2xl font-semibold text-success mt-2">{formatCurrency(summary.approved)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-fg-subtle">Rejected claims</p>
          <p className="text-2xl font-semibold text-danger mt-2">{summary.rejected}</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Expense History" subtitle={`${mine.length} claims`} />
        {isLoading ? <Skeleton className="h-40 m-5" /> : <DataTable columns={columns} data={mine} pageSize={8} />}
      </Card>
    </div>
  );
}
