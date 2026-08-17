import { useState } from 'react';
import { Plus, TrendingUp } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, StatusBadge, Modal, Select, Input, Textarea } from '../../components/ui';
import { useEmployees, useEmployeeMutations } from '../../hooks/useEmployees';
import { formatCurrency, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function SalaryRevisions() {
  const { employees } = useEmployees();
  const { update } = useEmployeeMutations();
  const [revisions, setRevisions] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ employeeId: '', newCtc: '', effectiveDate: '', reason: '' });

  const employeeOptions = employees.map((e) => ({ value: e.id, label: `${e.name} · ${e.designation}` }));

  const submit = async () => {
    if (!form.employeeId || !form.newCtc || !form.effectiveDate) return toast.error('Please fill all required fields');
    const emp = employees.find((e) => e.id === form.employeeId);
    const monthly = Math.round(Number(form.newCtc) / 12);
    const basic = Math.round(monthly * 0.5);
    const hra = Math.round(basic * 0.4);
    const da = Math.round(basic * 0.1);
    const special = monthly - basic - hra - da;
    const previousCtc = ((emp?.salary?.basic || 0) + (emp?.salary?.hra || 0) + (emp?.salary?.da || 0) + (emp?.salary?.special || 0)) * 12;
    try {
      await update.mutateAsync({
        id: form.employeeId,
        payload: {
          salaryDetails: { basic, hra, da, special, ctc: monthly },
          dateOfJoining: emp?.joinDate,
        },
      });
      setRevisions((rs) => [{
        id: `REV-${Date.now()}`,
        employeeId: form.employeeId,
        previousCtc,
        newCtc: Number(form.newCtc),
        effectiveDate: form.effectiveDate,
        reason: form.reason,
        status: 'approved',
      }, ...rs]);
      setModal(false);
      setForm({ employeeId: '', newCtc: '', effectiveDate: '', reason: '' });
      toast.success('Salary updated on server');
    } catch (err) {
      toast.error(err.message || 'Failed to update salary');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Salary Revisions" subtitle="Update employee CTC via the employee record" actions={<Button icon={Plus} onClick={() => setModal(true)}>Request Revision</Button>} />
      <Card>
        <CardHeader title="Revision History" subtitle={`${revisions.length} records this session`} />
        <div className="p-5 pt-3 space-y-2">
          {revisions.length === 0 ? (
            <p className="text-sm text-fg-subtle">Submit a revision to update salary on the server. History is kept for this session.</p>
          ) : revisions.map((r) => {
            const e = employees.find((x) => x.id === r.employeeId);
            const delta = r.previousCtc ? (((r.newCtc - r.previousCtc) / r.previousCtc) * 100).toFixed(1) : '—';
            return (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar name={e?.name} size="md" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{e?.name}</p>
                    <p className="text-xs text-fg-subtle">{formatCurrency(r.previousCtc)} → {formatCurrency(r.newCtc)} {delta !== '—' && <span className="text-success">(+{delta}%)</span>}</p>
                    <p className="text-xs text-fg-muted truncate">{r.reason} · effective {formatDate(r.effectiveDate)}</p>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            );
          })}
        </div>
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Request Salary Revision" footer={<><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button icon={TrendingUp} onClick={submit} loading={update.isPending}>Update Salary</Button></>}>
        <div className="space-y-4">
          <Select label="Employee" placeholder="Select employee" options={employeeOptions} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
          <Input label="New CTC (Annual INR)" type="number" value={form.newCtc} onChange={(e) => setForm({ ...form, newCtc: e.target.value })} />
          <Input label="Effective date" type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
          <Textarea label="Reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
