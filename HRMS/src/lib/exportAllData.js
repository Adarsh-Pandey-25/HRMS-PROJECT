import { fetchAllEmployeesApi } from '../api/employees.api';
import { fetchAllLeavesApi } from '../api/leaves.api';
import { fetchAllReimbursementsApi } from '../api/reimbursements.api';
import { fetchAssetsApi } from '../api/assets.api';
import { fetchAllTicketsApi } from '../api/helpdesk.api';
import { fetchJobsApi, fetchCandidatesApi } from '../api/recruitment.api';
import { exportData } from './export';
import { formatCurrency, formatDate } from './utils';

function employeeRows(list) {
  return list.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.workEmail,
    department: e.department,
    designation: e.designation,
    status: e.status,
    joinDate: e.joinDate ? formatDate(e.joinDate) : '',
  }));
}

function leaveRows(list) {
  return list.map((l) => ({
    employee: l.employeeName || l.employeeId,
    type: l.label || l.leaveType || l.type,
    from: l.from ? formatDate(l.from) : '',
    to: l.to ? formatDate(l.to) : '',
    days: l.days,
    status: l.status,
    reason: l.reason,
  }));
}

function claimRows(list) {
  return list.map((c) => ({
    employee: c.employeeName || c.employeeId,
    category: c.category,
    date: c.date ? formatDate(c.date) : '',
    amount: c.amount,
    status: c.status,
    description: c.description || c.notes || '',
  }));
}

function assetRows(list) {
  return list.map((a) => ({
    name: a.name,
    category: a.category,
    serial: a.serialNumber,
    status: a.status,
    assignedTo: a.assignedTo || '',
    cost: a.purchaseCost != null ? formatCurrency(a.purchaseCost) : '',
  }));
}

function ticketRows(list) {
  return list.map((t) => ({
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    created: t.createdAt ? formatDate(t.createdAt) : '',
  }));
}

function jobRows(list) {
  return list.map((j) => ({
    title: j.title,
    department: j.department,
    location: j.location,
    status: j.status,
    openings: j.openings,
  }));
}

function candidateRows(list) {
  return list.map((c) => ({
    name: c.name,
    job: c.jobTitle || c.jobId,
    stage: c.stage,
    email: c.email,
    applied: c.appliedAt ? formatDate(c.appliedAt) : '',
  }));
}

/** Fetch company-scoped datasets and export in the chosen format. */
export async function exportAllCompanyData(format, companyName = 'Company') {
  const [employees, leaves, claims, assets, tickets, jobs, candidates] = await Promise.all([
    fetchAllEmployeesApi(),
    fetchAllLeavesApi(),
    fetchAllReimbursementsApi(),
    fetchAssetsApi(),
    fetchAllTicketsApi(),
    fetchJobsApi(),
    fetchCandidatesApi(),
  ]);

  const sheets = [
    { name: 'Employees', rows: employeeRows(employees), columns: [
      { key: 'id', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'status', label: 'Status' }, { key: 'joinDate', label: 'Join Date' },
    ] },
    { name: 'Leaves', rows: leaveRows(leaves), columns: [
      { key: 'employee', label: 'Employee' }, { key: 'type', label: 'Leave Type' },
      { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'days', label: 'Days' },
      { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason' },
    ] },
    { name: 'Claims', rows: claimRows(claims), columns: [
      { key: 'employee', label: 'Employee' }, { key: 'category', label: 'Category' },
      { key: 'date', label: 'Date' }, { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' }, { key: 'description', label: 'Description' },
    ] },
    { name: 'Assets', rows: assetRows(assets), columns: [
      { key: 'name', label: 'Asset Name' }, { key: 'category', label: 'Category' },
      { key: 'serial', label: 'Serial No.' }, { key: 'status', label: 'Status' },
      { key: 'assignedTo', label: 'Assigned To' }, { key: 'cost', label: 'Cost' },
    ] },
    { name: 'Helpdesk', rows: ticketRows(tickets), columns: [
      { key: 'subject', label: 'Subject' }, { key: 'category', label: 'Category' },
      { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
      { key: 'created', label: 'Created' },
    ] },
    { name: 'Jobs', rows: jobRows(jobs), columns: [
      { key: 'title', label: 'Job Title' }, { key: 'department', label: 'Department' },
      { key: 'location', label: 'Location' }, { key: 'status', label: 'Status' },
      { key: 'openings', label: 'Openings' },
    ] },
    { name: 'Candidates', rows: candidateRows(candidates), columns: [
      { key: 'name', label: 'Candidate' }, { key: 'job', label: 'Job' },
      { key: 'stage', label: 'Stage' }, { key: 'email', label: 'Email' },
      { key: 'applied', label: 'Applied On' },
    ] },
  ].filter((s) => s.rows.length > 0);

  if (!sheets.length) return false;

  const stamp = new Date().toISOString().slice(0, 10);
  return exportData({
    format,
    filename: `${companyName.replace(/\s+/g, '-').toLowerCase()}-data-${stamp}`,
    title: `${companyName} — Data Export`,
    companyName,
    subtitle: 'Complete company data export',
    sheets,
  });
}
