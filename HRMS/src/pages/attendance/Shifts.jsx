import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Users, Clock } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, Badge, Modal, Input, Select,
  SearchInput, Avatar, Skeleton, EmptyState, Tabs,
} from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { useEmployees, useEmployeeMutations } from '../../hooks/useEmployees';
import { updateSettingApi } from '../../api/settings.api';
import { filterDirectoryEmployees, employeeProfilePath } from '../../lib/employeeRoutes';
import {
  groupEmployeesByShift,
  employeeShiftLabel,
  buildShiftAddressPatch,
  resolveEmployeeShift,
} from '../../lib/shifts';
import toast from 'react-hot-toast';

function AddShiftModal({ open, onClose }) {
  const addShift = useSettingsStore((s) => s.addShift);
  const [form, setForm] = useState({ name: '', start: '09:00', end: '18:00' });
  const save = async () => {
    if (!form.name.trim()) return toast.error('Shift name is required');
    addShift(form);
    try {
      const cfg = useSettingsStore.getState().attendanceConfig;
      await updateSettingApi('attendance_config', cfg);
      toast.success('Shift added and saved');
    } catch {
      toast.success('Shift added locally — open Attendance Config and Save to sync');
    }
    setForm({ name: '', start: '09:00', end: '18:00' });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add Shift" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Add Shift</Button></>}>
      <div className="space-y-4">
        <Input label="Shift name" placeholder="e.g. Morning Shift" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Start time" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <Input label="End time" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

export default function Shifts() {
  const shifts = useSettingsStore((s) => s.attendanceConfig.shifts);
  const removeShift = useSettingsStore((s) => s.removeShift);
  const { employees, isLoading } = useEmployees();
  const { update } = useEmployeeMutations();
  const [modal, setModal] = useState(false);
  const [tab, setTab] = useState('assignments');
  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [savingId, setSavingId] = useState(null);

  const roster = useMemo(
    () => filterDirectoryEmployees(employees).filter((e) => e.isActive !== false),
    [employees],
  );

  const { groups, unassigned } = useMemo(
    () => groupEmployeesByShift(roster, shifts),
    [roster, shifts],
  );

  const shiftOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...shifts.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name })),
    ],
    [shifts],
  );

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((emp) => {
      const current = resolveEmployeeShift(emp, shifts);
      if (shiftFilter === '__none__' && current) return false;
      if (shiftFilter && shiftFilter !== '__none__' && current?.id !== shiftFilter) return false;
      if (!q) return true;
      return (
        emp.name?.toLowerCase().includes(q)
        || emp.employeeCode?.toLowerCase().includes(q)
        || emp.department?.toLowerCase().includes(q)
        || employeeShiftLabel(emp, shifts).toLowerCase().includes(q)
      );
    });
  }, [roster, search, shiftFilter, shifts]);

  const handleRemove = async (id) => {
    const assigned = roster.filter((e) => resolveEmployeeShift(e, shifts)?.id === id);
    if (assigned.length > 0) {
      return toast.error(`Reassign ${assigned.length} employee(s) before deleting this shift`);
    }
    removeShift(id);
    try {
      const cfg = useSettingsStore.getState().attendanceConfig;
      await updateSettingApi('attendance_config', cfg);
      toast.success('Shift removed');
    } catch {
      toast.success('Removed locally — Save Attendance Config to sync');
    }
  };

  const assignShift = async (employee, shiftId) => {
    const shift = shiftId ? shifts.find((s) => s.id === shiftId) : null;
    setSavingId(employee.id);
    try {
      await update.mutateAsync({
        id: employee.id,
        payload: {
          address: buildShiftAddressPatch(employee.addressRaw, shift),
        },
      });
      toast.success(shift ? `${employee.name} assigned to ${shift.name}` : `${employee.name} unassigned from shift`);
    } catch (err) {
      toast.error(err.message || 'Failed to update shift');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Shifts"
        subtitle="Define shift timings and track which employees work on each shift"
        actions={<Button icon={Plus} onClick={() => setModal(true)}>Add Shift</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {groups.map(({ shift, employees: emps }) => (
          <Card key={shift.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-fg">{shift.name}</p>
                <p className="text-xs text-fg-subtle mt-0.5">{shift.start} – {shift.end}</p>
              </div>
              <Badge tone="primary">{emps.length}</Badge>
            </div>
            <p className="text-xs text-fg-muted mt-2">{emps.length} employee{emps.length === 1 ? '' : 's'}</p>
          </Card>
        ))}
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-fg">Unassigned</p>
              <p className="text-xs text-fg-subtle mt-0.5">No shift set</p>
            </div>
            <Badge tone="neutral">{unassigned.length}</Badge>
          </div>
          <p className="text-xs text-fg-muted mt-2">{unassigned.length} employee{unassigned.length === 1 ? '' : 's'}</p>
        </Card>
      </div>

      <Tabs
        tabs={[
          { id: 'assignments', label: 'Employee assignments' },
          { id: 'timings', label: 'Shift timings' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'assignments' && (
        <Card>
          <CardHeader
            title="Employee Shift Assignments"
            subtitle={`${roster.length} active employees · assign or change shifts`}
          />
          <div className="px-5 pb-3 flex flex-col sm:flex-row gap-3">
            <SearchInput
              placeholder="Search by name, ID, department…"
              value={search}
              onChange={setSearch}
              className="sm:max-w-xs"
            />
            <Select
              options={[
                { value: '', label: 'All shifts' },
                { value: '__none__', label: 'Unassigned only' },
                ...shifts.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="sm:max-w-[200px]"
            />
          </div>
          <div className="p-5 pt-0 overflow-x-auto">
            {isLoading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : filteredRoster.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No employees found"
                message={roster.length === 0 ? 'Add employees first, then assign them to shifts here or from Add/Edit Employee.' : 'Try a different search or filter.'}
              />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Employee', 'Department', 'Current shift', 'Assign shift'].map((h) => (
                      <th key={h} className="py-2.5 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRoster.map((emp) => {
                    const current = resolveEmployeeShift(emp, shifts);
                    return (
                      <tr key={emp.id} className="border-b border-border/50">
                        <td className="py-3">
                          <Link to={employeeProfilePath(emp)} className="flex items-center gap-2 hover:text-primary">
                            <Avatar name={emp.name} size="xs" />
                            <div>
                              <p className="font-medium text-fg">{emp.name}</p>
                              <p className="text-xs text-fg-subtle">{emp.employeeCode || emp.id?.slice(0, 8)}</p>
                            </div>
                          </Link>
                        </td>
                        <td className="py-3 text-fg-muted">{emp.department || '—'}</td>
                        <td className="py-3">
                          {current ? (
                            <span className="inline-flex items-center gap-1.5 text-fg">
                              <Clock className="h-3.5 w-3.5 text-fg-subtle" />
                              {current.name} ({current.start}–{current.end})
                            </span>
                          ) : (
                            <Badge tone="neutral">Unassigned</Badge>
                          )}
                        </td>
                        <td className="py-3 min-w-[180px]">
                          <Select
                            options={shiftOptions}
                            value={current?.id || ''}
                            onChange={(e) => assignShift(emp, e.target.value || null)}
                            disabled={savingId === emp.id}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {tab === 'timings' && (
        <Card>
          <CardHeader title="Shift Timings" subtitle={`${shifts.length} shifts configured`} />
          <div className="p-5 pt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Shift Name', 'Start', 'End', 'Employees', 'Active', ''].map((h) => (
                    <th key={h} className="py-2.5 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shifts.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-fg-subtle text-sm">No shifts yet. Add one to get started.</td></tr>
                ) : shifts.map((sh) => {
                  const count = groups.find((g) => g.shift.id === sh.id)?.employees.length || 0;
                  return (
                    <tr key={sh.id} className="border-b border-border/50">
                      <td className="py-3 text-fg font-medium">{sh.name}</td>
                      <td className="py-3 text-fg-muted">{sh.start}</td>
                      <td className="py-3 text-fg-muted">{sh.end}</td>
                      <td className="py-3 text-fg-muted">{count}</td>
                      <td className="py-3"><Badge tone={sh.active !== false ? 'success' : 'neutral'}>{sh.active !== false ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="py-3 text-right">
                        <button type="button" onClick={() => handleRemove(sh.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddShiftModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}
