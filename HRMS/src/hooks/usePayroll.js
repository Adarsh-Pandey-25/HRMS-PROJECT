import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchAllPayslipsForYearApi, fetchPayrollMonthApi, fetchMonthPayslipsApi,
  initializePayrollMonthApi, generatePayslipsApi, publishPayslipApi,
  payslipDownloadUrl, downloadPayslipApi, fetchPayrollChecksApi,
} from '../api/payroll.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export { payslipDownloadUrl, downloadPayslipApi };

export function useMyPayslips(year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id);
  const y = year || new Date().getFullYear();
  return useQuery({
    queryKey: ['payroll', 'payslips', 'mine', y, userId],
    queryFn: () => fetchAllPayslipsForYearApi(y, { mine: true }),
    enabled: isAuthenticated && Boolean(userId),
    select: (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      // Keep one slip per month (prefer latest id); ignore accidental drafts
      const byMonth = new Map();
      for (const p of list) {
        if (p.employeeId && userId && p.employeeId !== userId) continue;
        const status = String(p.payslipStatus || p.status || '').toUpperCase();
        if (status && status !== 'PUBLISHED') continue;
        const key = `${p.year}-${p.monthNum}`;
        const prev = byMonth.get(key);
        if (!prev || String(p.id) > String(prev.id)) byMonth.set(key, p);
      }
      return [...byMonth.values()].sort((a, b) => (b.year - a.year) || (b.monthNum - a.monthNum));
    },
  });
}

/** Payslips for a year (HR/Admin): one employee's when employeeId is given (their profile), else everyone's. */
export function useAllPayslipsForYear(year, { employeeId, enabled = true } = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const y = year || new Date().getFullYear();
  return useQuery({
    queryKey: ['payroll', 'payslips', 'all', y, employeeId || 'everyone'],
    queryFn: () => fetchAllPayslipsForYearApi(y, { mine: false, employeeId }),
    enabled: isAuthenticated && enabled,
  });
}

export function usePayrollMonth(month, year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['payroll', 'month', month, year],
    queryFn: () => fetchPayrollMonthApi(month, year),
    enabled: isAuthenticated && Boolean(month && year),
  });
}

/** Every payslip of the month (all pages), so totals and bulk actions cover the whole company. */
export function useMonthPayslips(month, year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['payroll', 'payslips', month, year],
    queryFn: () => fetchMonthPayslipsApi(month, year),
    enabled: isAuthenticated && Boolean(month && year),
  });
}

/** Pending requests, missing details and settings to sort out before a month's payroll. */
export function usePayrollChecks(month, year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['payroll', 'checks', month, year],
    queryFn: () => fetchPayrollChecksApi(month, year),
    enabled: isAuthenticated && Boolean(month && year),
  });
}

export function usePayrollMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['payroll']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    initMonth: useMutation({ mutationFn: ({ month, year }) => initializePayrollMonthApi(month, year), onSuccess: invalidate }),
    generate: useMutation({ mutationFn: ({ payrollMonthId, userId }) => generatePayslipsApi(payrollMonthId, userId), onSuccess: invalidate }),
    publish: useMutation({ mutationFn: publishPayslipApi, onSuccess: invalidate }),
  };
}
