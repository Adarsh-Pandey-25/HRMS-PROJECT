/** Resolve configured shift by stored name or id on an employee record. */
export function resolveEmployeeShift(employee, shifts = []) {
  const addr = employee?.addressRaw || {};
  const shiftId = employee?.shiftId || addr.shift_id || addr.shiftId || '';
  const shiftName = employee?.shift || addr.shift || '';
  if (shiftId) {
    const byId = shifts.find((s) => s.id === shiftId);
    if (byId) return byId;
  }
  if (shiftName) {
    const byName = shifts.find((s) => s.name === shiftName);
    if (byName) return byName;
  }
  return null;
}

export function employeeShiftLabel(employee, shifts = []) {
  const shift = resolveEmployeeShift(employee, shifts);
  if (shift) return `${shift.name} (${shift.start}–${shift.end})`;
  const name = employee?.shift || employee?.addressRaw?.shift;
  return name || 'Unassigned';
}

export function groupEmployeesByShift(employees, shifts = []) {
  const activeShifts = shifts.filter((s) => s.active !== false);
  const groups = activeShifts.map((shift) => ({
    shift,
    employees: [],
  }));
  const unassigned = [];

  for (const emp of employees) {
    const matched = resolveEmployeeShift(emp, activeShifts);
    if (matched) {
      const bucket = groups.find((g) => g.shift.id === matched.id);
      if (bucket) bucket.employees.push(emp);
      else unassigned.push(emp);
    } else {
      unassigned.push(emp);
    }
  }

  return { groups, unassigned };
}

export function buildShiftAddressPatch(existingRaw = {}, shift) {
  const prev = (existingRaw && typeof existingRaw === 'object') ? existingRaw : {};
  if (!shift) {
    return { ...prev, shift: '', shift_id: '' };
  }
  return {
    ...prev,
    shift: shift.name,
    shift_id: shift.id,
  };
}
