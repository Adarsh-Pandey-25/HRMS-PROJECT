import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Card, CardHeader, Skeleton, SaveStatusIndicator } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { fetchAllSettingsApi, fetchSettingApi, updateSettingApi } from '../../api/settings.api';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { toSnakeCase } from '../../lib/case';
import { useAutosave } from '../../hooks/useAutosave';
import { APPROVAL_FLOW_OPTIONS, LEAVE_LEVEL_FOR_FLOW, normalizeFlow } from '../../lib/approvalFlow';

/**
 * Settings → Approval Flows: who approves each kind of request, in one
 * place (lib/approvalFlow.js; the server applies the same rules, and
 * WhatsApp approval messages follow them). Each choice is saved where that
 * request type has always kept it — leave in leave_policy_meta, expenses in
 * expense_config — and work from home in approval_flows. Attendance
 * corrections stay with HR: approving one changes the attendance record.
 */

/** The setting as stored now; a key never saved yet is {}. */
const latest = async (key) => {
  try {
    return (await fetchSettingApi(key))?.value || {};
  } catch (err) {
    if (err?.status === 404) return {};
    throw err;
  }
};

/** One request type's choices. Each card saves on its own, so quick changes to two cards both stick. */
function FlowCard({ title, subtitle, name, value, onSave }) {
  const { status, save, retry } = useAutosave(onSave);
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={<SaveStatusIndicator status={status} onRetry={retry} />} />
      <div className="p-5 pt-3 space-y-2.5">
        {APPROVAL_FLOW_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3.5 py-3 text-sm text-fg has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input type="radio" name={name} className="mt-0.5 h-4 w-4 accent-primary" checked={value === opt.value} onChange={() => save(opt.value)} />
            <span>
              <span className="font-medium">{opt.label}</span>
              <span className="mt-0.5 block text-xs text-fg-subtle">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}

export function ApprovalFlowsSection() {
  const qc = useQueryClient();
  // Same query the settings bootstrap uses: opening this page loads the
  // company's settings now rather than after the idle delay.
  const { isLoading } = useQuery({ queryKey: ['settings', 'all'], queryFn: fetchAllSettingsApi, staleTime: 60_000 });
  const leaveFlow = normalizeFlow(useSettingsStore((s) => s.leavePolicy?.approvalLevel), 'manager-only');
  const expenseFlow = normalizeFlow(useSettingsStore((s) => s.expenseConfig?.approvalFlow));
  const wfhFlow = normalizeFlow(useSettingsStore((s) => s.approvalFlows?.wfh), 'manager-or-hr');
  const updateLeavePolicy = useSettingsStore((s) => s.updateLeavePolicy);
  const updateExpenseConfig = useSettingsStore((s) => s.updateExpenseConfig);
  const updateApprovalFlows = useSettingsStore((s) => s.updateApprovalFlows);

  // Each save reads the record, changes one field and writes it back, so its
  // other fields (leave accrual, the receipt limit) stay exactly as stored.
  const saveLeave = useCallback(async (flow) => {
    const meta = await latest('leave_policy_meta');
    const approvalLevel = LEAVE_LEVEL_FOR_FLOW[flow];
    // Stored in snake_case, as the Leave Policy section writes it.
    await updateSettingApi('leave_policy_meta', { ...toSnakeCase(meta), approval_level: approvalLevel });
    updateLeavePolicy({ approvalLevel });
    await invalidateAndRefetch(qc, ['leaves']);
  }, [qc, updateLeavePolicy]);

  const saveWfh = useCallback(async (flow) => {
    const flows = await latest('approval_flows');
    await updateSettingApi('approval_flows', { ...flows, wfh: flow });
    updateApprovalFlows({ wfh: flow });
    await invalidateAndRefetch(qc, ['attendance', 'wfh-pending']);
  }, [qc, updateApprovalFlows]);

  const saveExpense = useCallback(async (flow) => {
    const cfg = await latest('expense_config');
    await updateSettingApi('expense_config', { ...cfg, approvalFlow: flow });
    updateExpenseConfig({ approvalFlow: flow });
    await invalidateAndRefetch(qc, ['reimbursements']);
  }, [qc, updateExpenseConfig]);

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">
        Who approves each kind of request. Requests from people without a manager always go to HR, and WhatsApp approval messages follow the same choice.
      </p>
      <FlowCard title="Leave" subtitle="Who approves leave requests." name="leaveFlow" value={leaveFlow} onSave={saveLeave} />
      <FlowCard title="Work from home" subtitle="Who approves work-from-home requests." name="wfhFlow" value={wfhFlow} onSave={saveWfh} />
      <FlowCard title="Expense claims" subtitle="Who approves expense claims." name="expenseFlow" value={expenseFlow} onSave={saveExpense} />
      <Card>
        <CardHeader title="Attendance corrections" subtitle="Who approves attendance corrections." />
        <div className="p-5 pt-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-primary bg-primary/5 px-3.5 py-3 text-sm text-fg">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">HR only</span>
              <span className="mt-0.5 block text-xs text-fg-subtle">Approving a correction changes the employee&apos;s attendance record, so HR and admins decide these.</span>
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
