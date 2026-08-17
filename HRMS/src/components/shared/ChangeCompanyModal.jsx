import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Select, Avatar } from '../ui';
import { useAccessibleCompanies } from '../../hooks/useCompanies';
import { useEmployeeMutations } from '../../hooks/useEmployees';
import { companyOptionLabel } from '../../lib/companyLabels';

/**
 * Quick reassign employee to main company or subsidiary (Admin / HR).
 */
export function ChangeCompanyModal({ open, onClose, employee, onSuccess }) {
  const qc = useQueryClient();
  const companiesQ = useAccessibleCompanies(open);
  const { update } = useEmployeeMutations();
  const [companyId, setCompanyId] = useState('');

  useEffect(() => {
    if (open && employee) {
      setCompanyId(String(employee.companyId || employee.company_id || ''));
    }
  }, [open, employee]);

  const options = (companiesQ.data || [])
    .filter((c) => c.isActive !== false)
    .map((c) => ({
      value: c.id,
      label: companyOptionLabel(c),
    }));

  const currentId = String(employee?.companyId || employee?.company_id || '');
  const unchanged = String(companyId) === currentId;
  const saving = update.isPending;

  const submit = async () => {
    if (!employee?.id || !companyId) {
      toast.error('Select a company');
      return;
    }
    if (unchanged) {
      onClose?.();
      return;
    }
    try {
      await update.mutateAsync({ id: employee.id, payload: { companyId } });
      await qc.invalidateQueries({ queryKey: ['companies'] });
      const label = options.find((o) => o.value === companyId)?.label || 'selected company';
      toast.success(`${employee.name || 'Employee'} moved to ${label}`);
      onSuccess?.(companyId);
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Failed to change company');
    }
  };

  if (!employee) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change company"
      subtitle="Move this employee to another company in your organization."
      size="sm"
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving} disabled={!companyId || unchanged}>
            Save
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <Avatar name={employee.name} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-fg truncate">{employee.name}</p>
            <p className="text-xs text-fg-subtle truncate">
              {employee.employeeCode || employee.designation || employee.email || ''}
              {employee.companyName ? ` · ${employee.companyName}` : ''}
            </p>
          </div>
        </div>

        <Select
          label="Assign to company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={options}
          placeholder="Select company"
          hint="Main company and subsidiaries you can manage"
        />

        {companiesQ.isLoading && (
          <p className="text-xs text-fg-subtle inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Loading companies…
          </p>
        )}
      </div>
    </Modal>
  );
}
