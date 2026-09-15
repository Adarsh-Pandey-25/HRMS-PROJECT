import { useState } from 'react';
import { Check, X, MoreHorizontal, Eye } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, StatusBadge, EmptyState, Skeleton, Modal } from '../../components/ui';
import { useTeamReimbursements, useAllReimbursements } from '../../hooks/useReimbursements';
import { useReimbursementMutations } from '../../hooks/useReimbursements';
import { useCan } from '../../hooks/useCan';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency, formatDate } from '../../lib/utils';
import { CAT_ICON } from './catIcons';
import toast from 'react-hot-toast';

export default function ExpenseApprovals() {
 const canApprove = useCan('expenses', 'approve');
 const role = useAuthStore((s) => s.role);
 const isHrOrAdmin = role === 'hr' || role === 'admin';
 const [previewUrl, setPreviewUrl] = useState('');

 const teamQuery = useTeamReimbursements({ enabled: !isHrOrAdmin, status: 'pending' });
 const allQuery = useAllReimbursements({ enabled: isHrOrAdmin, status: 'pending' });
 const expenses = isHrOrAdmin ? (allQuery.data || []) : (teamQuery.data || []);
 const isLoading = isHrOrAdmin ? allQuery.isLoading : teamQuery.isLoading;

 const { approve, reject } = useReimbursementMutations();
 const pending = expenses.filter((e) => e.status === 'pending');

 const openReceipt = async (id) => {
 try {
 const { openReceiptApi } = await import('../../api/reimbursements.api');
 const url = await openReceiptApi(id);
 setPreviewUrl(url);
 } catch (err) {
 toast.error(err.message || 'Failed to load receipt');
 }
 };

 const act = async (id, action) => {
 try {
 if (action === 'approved') await approve.mutateAsync(id);
 else await reject.mutateAsync({ id, reason: 'Rejected by approver' });
 toast.success(`Expense ${action}`);
 } catch (err) {
 toast.error(err.message || 'Action failed');
 }
 };

 return (
 <div className="space-y-6 animate-fade-in">
 <PageHeader title="Approval Queue" subtitle="Pending expense claims awaiting your action" />

 <Card>
 <CardHeader title="Approval Queue" subtitle={`${pending.length} pending`} />
 <div className="p-5 pt-3">
 {isLoading ? (
 <Skeleton className="h-24 w-full" />
 ) : pending.length === 0 ? (
 <EmptyState icon={Check} title="All settled" message="No pending expense claims." />
 ) : (
 <div className="space-y-2">
 {pending.map((e) => {
 const Icon = CAT_ICON[e.category] || MoreHorizontal;
 return (
 <div key={e.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
 <div className="flex items-center gap-3 flex-1 min-w-0">
 <Avatar name={e.employeeName || 'Employee'} size="md" />
 <div className="min-w-0">
 <p className="text-sm font-medium text-fg">{e.employeeName || 'Employee'}</p>
 <p className="text-xs text-fg-subtle flex items-center gap-1.5 capitalize"><Icon className="h-3 w-3" /> {e.category} &middot; {formatDate(e.date, 'dd MMM')}</p>
 <p className="text-xs text-fg-muted truncate">{e.description}</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {e.receiptUrl && (
 <Button variant="ghost" size="sm" icon={Eye} onClick={() => openReceipt(e.id)} title="View receipt" />
 )}
 <span className="text-base font-semibold text-fg">{formatCurrency(e.amount)}</span>
 {canApprove ? (
 <>
 <Button variant="danger-ghost" size="sm" icon={X} onClick={() => act(e.id, 'rejected')} />
 <Button size="sm" icon={Check} onClick={() => act(e.id, 'approved')}>Approve</Button>
 </>
 ) : (
 <StatusBadge status={e.status} />
 )}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </Card>

 {/* Receipt preview modal */}
 <Modal open={!!previewUrl} onClose={() => setPreviewUrl('')} title="Receipt" size="lg">
 {previewUrl && (
 <img src={previewUrl} alt="Receipt" className="w-full max-h-[70vh] object-contain rounded-lg" />
 )}
 </Modal>
 </div>
 );
}
