import { useState, useMemo } from 'react';
import { PageHeader, Card, CardHeader, Avatar, StatusBadge, DataTable, Select, Skeleton } from '../../components/ui';
import { useAllReimbursements } from '../../hooks/useReimbursements';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { formatCurrency, formatDate, humanize } from '../../lib/utils';
import { ExportButton } from '../../components/shared/ExportButton';

export default function AllClaims() {
  const { data: expenses = [], isLoading } = useAllReimbursements();
  const employeeMap = useEmployeeMap();
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => expenses.filter((e) => !status || e.status === status), [expenses, status]);

  const exportRows = useMemo(
    () => filtered.map((e) => ({
      employee: e.employeeName || employeeMap[e.employeeId]?.name || e.employeeId,
      category: e.category,
      date: e.date,
      amount: e.amount,
      status: e.status,
      description: e.description || e.notes || '',
    })),
    [filtered, employeeMap]
  );

  const columns = [
    {
      id: 'employee', header: 'Employee',
      cell: ({ row }) => {
        const e = employeeMap[row.original.employeeId];
        const name = row.original.employeeName || e?.name || 'Employee';
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={name} size="sm" />
            <span className="font-medium text-fg">{name}</span>
          </div>
        );
      },
    },
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => <span className="capitalize">{humanize(getValue())}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue()) },
    { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => <span className="font-medium">{formatCurrency(getValue())}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="All Claims" subtitle="Every expense claim across the organisation" />

      <Card>
        <CardHeader
          title="All Claims"
          subtitle={`${filtered.length} claims`}
          action={
            <div className="flex items-center gap-2">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} options={['draft', 'pending', 'approved', 'rejected', 'paid']} placeholder="All statuses" className="h-9 text-xs" />
              <ExportButton
                rows={exportRows}
                filename="all-claims"
                title="All Expense Claims"
                columns={['employee', 'category', 'date', 'amount', 'status', 'description']}
              />
            </div>
          }
        />
        {isLoading ? <Skeleton className="h-48 m-5 rounded-xl" /> : <DataTable columns={columns} data={filtered} pageSize={10} />}
      </Card>
    </div>
  );
}
