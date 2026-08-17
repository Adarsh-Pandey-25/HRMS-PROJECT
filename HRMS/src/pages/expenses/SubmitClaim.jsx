import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { PageHeader, Card, Button, Select, Input, Textarea, FileUpload } from '../../components/ui';
import { useReimbursementMutations } from '../../hooks/useReimbursements';
import { useSettingsStore } from '../../store/settingsStore';
import { formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

const CATEGORIES = [
  { type: 'travel', name: 'Travel' },
  { type: 'food', name: 'Meals' },
  { type: 'other', name: 'Accommodation' },
  { type: 'office_supplies', name: 'Office Supplies' },
  { type: 'client_entertainment', name: 'Client Entertainment' },
  { type: 'medical', name: 'Medical' },
  { type: 'internet_phone', name: 'Internet' },
  { type: 'other', name: 'Other' },
];

export default function SubmitClaim() {
  const navigate = useNavigate();
  const { submit } = useReimbursementMutations();
  const requireReceiptAbove = Number(useSettingsStore((s) => s.expenseConfig?.requireReceiptAbove) ?? 500);

  const [form, setForm] = useState({
    categoryName: 'Travel',
    date: '',
    amount: '',
    description: '',
  });
  const [receipt, setReceipt] = useState(null);

  const onSubmit = async () => {
    if (!form.date || !form.amount || !form.description) return toast.error('Please fill all fields');
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid amount');

    if (requireReceiptAbove >= 0 && amount > requireReceiptAbove && !receipt) {
      return toast.error(`Receipt required for claims above ${formatCurrency(requireReceiptAbove)}`);
    }

    const cat = CATEGORIES.find((c) => c.name === form.categoryName) || CATEGORIES[0];
    const fd = new FormData();
    fd.append('reimbursement_type', cat.type);
    fd.append('expense_date', form.date);
    fd.append('amount', String(amount));
    fd.append('description', form.description);
    if (receipt) fd.append('receipt', receipt);
    try {
      await submit.mutateAsync(fd);
      toast.success('Expense claim submitted');
      navigate('/expenses/me');
    } catch (err) {
      toast.error(err.message || 'Submit failed');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button type="button" onClick={() => navigate('/expenses/me')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to My Claims
      </button>

      <PageHeader title="Submit Claim" subtitle="Claim a reimbursement for a business expense" />

      <Card className="p-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Category"
              value={form.categoryName}
              onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
              options={CATEGORIES.map((c) => ({ value: c.name, label: c.name }))}
            />
            <Input
              label="Amount (₹)"
              type="number"
              placeholder="e.g. 2500"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <Input label="Date" type="date" containerClass="sm:col-span-2" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe what this expense was for..." />
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">
              Receipt{requireReceiptAbove >= 0 ? ` (required above ${formatCurrency(requireReceiptAbove)})` : ''}
            </label>
            <FileUpload
              accept=".pdf,.jpg,.jpeg,.png"
              multiple={false}
              hint="Attach receipt · PDF or image up to 5MB"
              onChange={(files) => setReceipt(files?.[0] || null)}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-5 border-t border-border/60">
          <Button variant="outline" onClick={() => navigate('/expenses/me')}>Cancel</Button>
          <Button icon={Send} onClick={onSubmit} loading={submit.isPending} disabled={submit.isPending}>Submit Claim</Button>
        </div>
      </Card>
    </div>
  );
}
