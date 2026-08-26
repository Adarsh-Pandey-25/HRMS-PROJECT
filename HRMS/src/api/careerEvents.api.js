import { apiRequest } from './client';
import { toCamelCase, toSnakeCase } from '../lib/case';

const EVENT_TYPE_LABELS = {
  joined: 'Joined',
  designation_change: 'Designation change',
  department_change: 'Department change',
  manager_change: 'Manager change',
  salary_change: 'Salary change',
  note: 'Career note',
};

function mapCareerEvent(row) {
  const c = toCamelCase(row);
  return {
    id: c.id,
    employeeId: c.employeeId,
    type: c.eventType,
    typeLabel: EVENT_TYPE_LABELS[c.eventType] || c.eventType,
    fromValue: c.fromValue,
    toValue: c.toValue,
    effectiveDate: c.effectiveDate,
    note: c.note,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    isSynthetic: Boolean(c.synthetic),
  };
}

export async function fetchCareerEventsApi(employeeId) {
  const rows = await apiRequest({ method: 'GET', url: `/employees/${employeeId}/career-events` });
  return (Array.isArray(rows) ? rows : []).map(mapCareerEvent);
}

export async function addCareerNoteApi(employeeId, { note, effectiveDate }) {
  const data = await apiRequest({
    method: 'POST',
    url: `/employees/${employeeId}/career-events`,
    data: toSnakeCase({ note, effectiveDate }),
  });
  return mapCareerEvent(data);
}
