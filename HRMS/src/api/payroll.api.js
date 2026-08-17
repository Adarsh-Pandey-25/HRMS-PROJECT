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

/** Re-apply current payroll settings to existing month payslips (draft + published). */
export async function recalculatePayslipsFromSettingsApi(month, year, employeeId) {
  const data = {};
  if (month != null) data.month = month;
  if (year != null) data.year = year;
  if (employeeId) data.employee_id = employeeId;
  return apiRequest({
    method: 'POST',
    url: '/payroll/payslips/recalculate-from-settings',
    data,
    // Many slips + PDF refresh can exceed the default 30s axios timeout.
    timeout: 120_000,
  });
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
