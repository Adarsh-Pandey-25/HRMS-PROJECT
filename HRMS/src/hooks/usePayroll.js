import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchAllPayslipsForYearApi, fetchPayrollMonthApi, fetchPayslipsApi,
  initializePayrollMonthApi, generatePayslipsApi, publishPayslipApi,
  payslipDownloadUrl, downloadPayslipApi,
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

/** All employees' payslips for a year (HR/Admin — e.g. employee profile). */
export function useAllPayslipsForYear(year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const y = year || new Date().getFullYear();
  return useQuery({
    queryKey: ['payroll', 'payslips', 'all', y],
    queryFn: () => fetchAllPayslipsForYearApi(y, { mine: false }),
    enabled: isAuthenticated,
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

export function useMonthPayslips(month, year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['payroll', 'payslips', month, year],
    queryFn: () => fetchPayslipsApi({ month, year }),
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
