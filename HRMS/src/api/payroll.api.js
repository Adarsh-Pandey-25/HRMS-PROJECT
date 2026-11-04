import { apiRequest } from './client';
import { mapPayslipFromApi } from '../lib/mappers';

const now = () => {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

export async function fetchPayslipsApi(query = {}) {
  const { month, year, mine } = { ...now(), ...query };
  const params = { month, year };
  if (mine) params.mine = true;
  const rows = await apiRequest({ method: 'GET', url: '/payroll/payslips', params });
  return (Array.isArray(rows) ? rows : []).map(mapPayslipFromApi);
}

export async function fetchAllPayslipsForYearApi(year, { mine = false } = {}) {
  const results = [];
  for (let month = 1; month <= 12; month += 1) {
    try {
      const rows = await fetchPayslipsApi({ month, year, mine });
      results.push(...(Array.isArray(rows) ? rows : []));
    } catch {
      /* month may have no payroll */
    }
  }
  return results.sort((a, b) => (b.year - a.year) || (b.monthNum - a.monthNum));
}

export async function fetchPayrollMonthApi(month, year) {
  return apiRequest({ method: 'GET', url: '/payroll/months', params: { month, year } });
}

export async function initializePayrollMonthApi(month, year) {
  return apiRequest({ method: 'POST', url: '/payroll/months', data: { month, year } });
}

export async function generatePayslipsApi(payrollMonthId, userId) {
  return apiRequest({
    method: 'POST',
    url: '/payroll/payslips/generate',
    data: userId ? { payroll_month_id: payrollMonthId, user_id: userId } : { payroll_month_id: payrollMonthId },
  });
}

export async function publishPayslipApi(id) {
  return apiRequest({ method: 'PUT', url: `/payroll/payslips/${id}/publish` });
}

/** Approve a draft payslip (approval before publishing). */
export async function approvePayslipApi(id) {
  return apiRequest({ method: 'PUT', url: `/payroll/payslips/${id}/approve` });
}

/** Approve every draft of a month that can be approved: { approved, skipped: [{ employeeId, reason }] }. */
export async function approveMonthApi(month, year) {
  return apiRequest({ method: 'POST', url: '/payroll/payslips/approve-month', data: { month, year } });
}

/** What to sort out before generating a month's payslips (read-only). */
export async function fetchPayrollChecksApi(month, year) {
  return apiRequest({ method: 'GET', url: '/payroll/checks', params: { month, year } });
}

/**
 * Downloads the month's bank upload file (published payslips, net payable).
 * Returns how many rows it has, their total, and how many were left out.
 */
export async function downloadBankFileApi(month, year) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const params = new URLSearchParams({ month: String(month), year: String(year) });
  const res = await fetch(`${base}/payroll/bank-file?${params}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || `bank-file-${year}-${String(month).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return {
    rows: Number(res.headers.get('x-bank-file-rows') || 0),
    total: Number(res.headers.get('x-bank-file-total') || 0),
    skipped: Number(res.headers.get('x-bank-file-skipped') || 0),
  };
}

/**
 * Downloads a month's file: 'ecr' (EPF, text), 'esi' (CSV), 'register'
 * (salary register, CSV) or 'journal' (accounting entry, CSV).
 * Returns how many members it has and how many were left out (no UAN / ESIC number).
 */
export async function downloadStatutoryFileApi(kind, month, year) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const params = new URLSearchParams({ month: String(month), year: String(year) });
  const path = {
    ecr: 'statutory/ecr', esi: 'statutory/esi', register: 'reports/register', journal: 'reports/journal', pt: 'reports/pt-register', lwf: 'reports/lwf-register',
  }[kind];
  const res = await fetch(`${base}/payroll/${path}?${params}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || `${kind}-${year}-${String(month).padStart(2, '0')}.${kind === 'ecr' ? 'txt' : 'csv'}`;
  a.click();
  URL.revokeObjectURL(url);
  return { rows: Number(res.headers.get('x-file-rows') || 0), skipped: Number(res.headers.get('x-file-skipped') || 0) };
}

/** Records that the bank paid these published payslips: { payslipIds, paidOn, reference }. */
export async function markPayslipsPaidApi(body) {
  return apiRequest({ method: 'POST', url: '/payroll/payments/mark-paid', data: body });
}

/** The signed-in employee's tax declaration for a tax year (Form 124). */
export async function fetchMyTaxDeclarationApi(taxYear) {
  return apiRequest({ method: 'GET', url: '/payroll/tax-declaration/me', params: { taxYear } });
}

/** Saves it, or sends it to HR: { taxYear, regime, declared, note, submit }. */
export async function saveMyTaxDeclarationApi(body) {
  return apiRequest({ method: 'PUT', url: '/payroll/tax-declaration/me', data: body });
}

/** HR: the company's declarations for a tax year ({ taxYear, status }). */
export async function fetchTaxDeclarationsApi(params) {
  const rows = await apiRequest({ method: 'GET', url: '/payroll/tax-declarations', params });
  return Array.isArray(rows) ? rows : [];
}

/** HR accepts a declaration with the amounts allowed: { allowed, regime, note }. */
export async function verifyTaxDeclarationApi(id, body) {
  return apiRequest({ method: 'POST', url: `/payroll/tax-declarations/${id}/verify`, data: body });
}

/** HR sends a declaration back with a note. */
export async function returnTaxDeclarationApi(id, note) {
  return apiRequest({ method: 'POST', url: `/payroll/tax-declarations/${id}/return`, data: { note } });
}

/** An employee's annual salary and tax statement ('me' for your own). */
export async function fetchAnnualTaxStatementApi(employeeId, taxYear) {
  const who = employeeId === 'me' ? 'me' : employeeId;
  return apiRequest({ method: 'GET', url: `/payroll/tds/statement/${who}`, params: { taxYear } });
}

/** Last month's published payslips whose pay comes out different today: { from, items }. */
export async function fetchAdjustmentsApi(month, year) {
  return apiRequest({ method: 'GET', url: '/payroll/adjustments', params: { month, year } });
}

/** Add the chosen differences to this month's payslips. */
export async function applyAdjustmentsApi(month, year, employeeIds) {
  return apiRequest({ method: 'POST', url: '/payroll/adjustments/apply', data: { month, year, employeeIds } });
}

/** A leaver's full and final settlement, for HR to review: { leaveDays, notice, fixedTerm, includeBonus }. */
export async function previewFullAndFinalApi(employeeId, inputs) {
  return apiRequest({ method: 'POST', url: `/payroll/fnf/${employeeId}/preview`, data: inputs });
}

/** Add it to the final payslip as one-time pay. */
export async function applyFullAndFinalApi(employeeId, inputs) {
  return apiRequest({ method: 'POST', url: `/payroll/fnf/${employeeId}/apply`, data: inputs });
}

/** Make the final payslip's draft (once the last working day is over). */
export async function generateFinalPayslipApi(employeeId) {
  return apiRequest({ method: 'POST', url: `/payroll/fnf/${employeeId}/generate` });
}

/** An employee's one-time pay and recoveries (arrears, bonus, notice pay, …). */
export async function fetchOneTimePayApi(employeeId) {
  const rows = await apiRequest({ method: 'GET', url: `/payroll/one-time/${employeeId}` });
  return Array.isArray(rows) ? rows : [];
}

/** HR adds one: { kind, name, amount, month, year, taxable, pfWage, esiWage, note }. */
export async function createOneTimePayApi(employeeId, body) {
  return apiRequest({ method: 'POST', url: `/payroll/one-time/${employeeId}`, data: body });
}

/** HR removes one, while its month's payslip isn't published. */
export async function cancelOneTimePayApi(employeeId, itemId) {
  return apiRequest({ method: 'POST', url: `/payroll/one-time/${employeeId}/${itemId}/cancel` });
}

/** An employee's loans and salary advances ('me' for your own). */
export async function fetchLoansApi(employeeId) {
  const rows = await apiRequest({ method: 'GET', url: `/payroll/loans/${employeeId === 'me' ? 'me' : employeeId}` });
  return Array.isArray(rows) ? rows : [];
}

/** HR records a loan or advance: { kind, principal, instalment, startMonth, startYear, note }. */
export async function createLoanApi(employeeId, body) {
  return apiRequest({ method: 'POST', url: `/payroll/loans/${employeeId}`, data: body });
}

/** HR cancels a loan entered by mistake (nothing recovered yet). */
export async function cancelLoanApi(employeeId, loanId) {
  return apiRequest({ method: 'POST', url: `/payroll/loans/${employeeId}/${loanId}/cancel` });
}

/** Salary TDS register for a tax year such as '2026-27' (published payslips only). */
export async function fetchTdsRegisterApi(taxYear) {
  return apiRequest({ method: 'GET', url: '/payroll/tds/register', params: { taxYear } });
}

/** Downloads a quarter's deductee rows for the TDS statement (Form 138) as CSV. */
export async function downloadForm138Api(taxYear, quarter) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const params = new URLSearchParams({ taxYear, quarter });
  const res = await fetch(`${base}/payroll/tds/form138?${params}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || `form138-data-${taxYear}-${quarter}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Re-apply current payroll settings to the month's draft payslips (a published one never changes). */
/** With { background: true } the server answers at once and recalculates
 *  in the background (Payroll Settings autosave); otherwise it waits. */
export async function recalculatePayslipsFromSettingsApi(month, year, employeeId, { background = false } = {}) {
  const data = {};
  if (month != null) data.month = month;
  if (year != null) data.year = year;
  if (employeeId) data.employee_id = employeeId;
  if (background) data.background = true;
  return apiRequest({
    method: 'POST',
    url: '/payroll/payslips/recalculate-from-settings',
    data,
    // Many slips + PDF refresh can exceed the default 30s axios timeout.
    timeout: 120_000,
  });
}

/** Monthly pay under current payroll settings (full month, no leave), from the server's payslip calculation. */
export async function fetchSalaryPreviewApi(employeeId) {
  return apiRequest({ method: 'GET', url: `/payroll/salary-preview/${employeeId}` });
}

export function payslipDownloadUrl(id) {
  const base = import.meta.env.VITE_API_URL || '/api';
  return `${base}/payroll/payslips/${id}/download`;
}

/** Download payslip PDF with auth (supports direct PDF stream or legacy redirect). */
export async function downloadPayslipApi(id) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const res = await fetch(`${base}/payroll/payslips/${id}/download`, {
    method: 'GET',
    credentials: 'include',
    redirect: 'manual',
    headers: {
      'ngrok-skip-browser-warning': 'true',
    },
  });

  if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 301) {
    const loc = res.headers.get('Location');
    if (loc) {
      window.open(loc, '_blank', 'noopener,noreferrer');
      return;
    }
    throw new Error('Download redirect failed');
  }

  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await res.json();
        message = body?.error?.message || body?.message || message;
      } else {
        const text = await res.text();
        if (text) message = text.slice(0, 200);
      }
    } catch {
      /* ignore parse errors */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  if (!blob.size) throw new Error('Empty payslip file');

  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || `payslip-${id}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Salary revisions — monthly components with an effective date. Revisions
 *  dated today or earlier apply immediately; later ones are scheduled. */
export async function fetchSalaryRevisionsApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/payroll/revisions', params });
  return Array.isArray(rows) ? rows : [];
}

export async function createSalaryRevisionApi({ employeeId, components, effectiveDate, reason }) {
  return apiRequest({
    method: 'POST',
    url: '/payroll/revisions',
    data: { employee_id: employeeId, components, effective_date: effectiveDate, reason: reason || null },
  });
}

export async function cancelSalaryRevisionApi(id) {
  return apiRequest({ method: 'POST', url: `/payroll/revisions/${id}/cancel` });
}

/** Company pay rules (late arrivals, overtime, day rate, missed check-out).
 *  `leaveFirst` (optional) switches "use casual leave first" in the leave policy. */
export async function savePayrollRulesApi(rules, { leaveFirst } = {}) {
  return apiRequest({
    method: 'PUT',
    url: '/payroll/rules',
    data: { rules: { ...rules, ...(typeof leaveFirst === 'boolean' ? { leaveFirst } : {}) } },
  });
}

/** What a month's pay would be under the settings on screen — nothing is saved. */
/** Do the month's payslips, salary register, bank file and journal agree? */
export async function fetchReconciliationApi(month, year) {
  return apiRequest({ method: 'GET', url: '/payroll/reports/reconciliation', params: { month, year } });
}

/** A yearly CTC split into a monthly salary by the company's template: { monthly: { basic, hra, da, special }, monthlyCtc, leftOver }. */
export async function splitCtcApi(annualCtc) {
  return apiRequest({ method: 'POST', url: '/payroll/ctc-split', data: { annualCtc } });
}

/** The legal values in force today and the standard (Settings → Payroll → Calculation). */
export async function fetchCalcDefaultsApi() {
  return apiRequest({ method: 'GET', url: '/payroll/calc-defaults' });
}

export async function simulatePayApi(body) {
  return apiRequest({ method: 'POST', url: '/payroll/simulate', data: body });
}

/** Which deductions apply to one employee (Employee → Payroll → Payroll setup). */
export async function fetchPayrollSetupApi(employeeId) {
  return apiRequest({ method: 'GET', url: `/payroll/setup/${employeeId}` });
}

export async function updatePayrollSetupApi(employeeId, changes) {
  return apiRequest({ method: 'PUT', url: `/payroll/setup/${employeeId}`, data: changes });
}
