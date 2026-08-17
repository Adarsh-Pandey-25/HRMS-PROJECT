import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format } from 'date-fns';
import { payrollRuns as seedRuns } from '../data';
import calculateEmployeePayroll from '../engine/payrollEngine';
import { useSettingsStore } from './settingsStore';

/**
 * Recomputes a full salary sheet for `month` from the live employee list.
 *
 * Thin adapter over the payroll engine: it pulls the company's live payroll
 * config from settingsStore and derives LOP days from status (this app has no
 * historical attendance store to reconstruct real per-day LOP from). The engine
 * does the real work — component earnings, PF/ESI/PT and regime-based TDS.
 */
export function computeMonthSheet(employees, month) {
  const config = useSettingsStore.getState().payrollConfig;
  return employees
    .filter((e) => e.status !== 'resigned' && e.status !== 'terminated')
    .map((e) =>
      calculateEmployeePayroll({
        employee: e,
        month,
        config,
        lopDays: e.status === 'probation' ? 1 : 0,
      })
    );
}

// The seed data's most recent non-draft run marks the last month payroll was
// genuinely processed for — auto-run should not repeat that month.
const seedLastProcessedMonth = seedRuns.find((r) => r.status !== 'draft')?.month || null;

export const usePayrollStore = create(
  persist(
    (set, get) => ({
      runs: seedRuns,
      sheets: {},
      lastAutoRunMonth: seedLastProcessedMonth,

      runPayroll: (month, employees, { auto = false } = {}) => {
        const sheet = computeMonthSheet(employees, month);
        const gross = sheet.reduce((a, r) => a + r.earnings.gross, 0);
        const deductions = sheet.reduce((a, r) => a + r.deductions.total, 0);
        const employerPf = sheet.reduce((a, r) => a + r.deductions.pf, 0);
        // Sum row net pay so the run total stays consistent with LOP-adjusted rows.
        const net = sheet.reduce((a, r) => a + r.netPay, 0);
        const run = {
          month,
          status: auto ? 'auto-processed' : 'processed',
          gross,
          deductions,
          net,
          employerPf,
          employees: sheet.length,
          processedOn: new Date().toISOString(),
        };
        set((s) => ({
          runs: [run, ...s.runs.filter((r) => r.month !== month)].sort((a, b) => b.month.localeCompare(a.month)),
          sheets: { ...s.sheets, [month]: sheet },
        }));
        return run;
      },

      markPaid: (month) =>
        set((s) => ({
          runs: s.runs.map((r) => (r.month === month ? { ...r, status: 'paid', paidOn: new Date().toISOString().slice(0, 10) } : r)),
        })),

      /** Edits one employee's row on an already-processed sheet, then re-derives that run's totals. */
      updateSheetRow: (month, employeeId, earningsPatch, deductionsPatch) =>
        set((s) => {
          const sheet = s.sheets[month];
          if (!sheet) return s;
          const updatedSheet = sheet.map((row) => {
            if (row.employeeId !== employeeId) return row;
            const earnings = { ...row.earnings, ...earningsPatch };
            const deductions = { ...row.deductions, ...deductionsPatch };
            earnings.gross = earnings.basic + earnings.hra + earnings.da + earnings.specialAllowance + earnings.incentive;
            deductions.total = deductions.pf + deductions.esic + deductions.pt + deductions.tds + deductions.advance;
            return { ...row, earnings, deductions, netPay: earnings.gross - (row.lopAmount || 0) - deductions.total };
          });
          const gross = updatedSheet.reduce((a, r) => a + r.earnings.gross, 0);
          const deductions = updatedSheet.reduce((a, r) => a + r.deductions.total, 0);
          const employerPf = updatedSheet.reduce((a, r) => a + r.deductions.pf, 0);
          const net = updatedSheet.reduce((a, r) => a + r.netPay, 0);
          return {
            sheets: { ...s.sheets, [month]: updatedSheet },
            runs: s.runs.map((r) => (r.month === month ? { ...r, gross, deductions, net, employerPf } : r)),
          };
        }),

      /**
       * Called once on app load. If the real calendar month has rolled over
       * since the last check and that month hasn't been processed yet, runs
       * payroll automatically — simulating a scheduled job that fires on the
       * 1st (with catch-up if the app wasn't opened exactly on the 1st).
       */
      checkAutoRun: (employees) => {
        const currentMonth = format(new Date(), 'yyyy-MM');
        const { runs, lastAutoRunMonth } = get();
        if (lastAutoRunMonth === currentMonth) return null;
        if (runs.some((r) => r.month === currentMonth && r.status !== 'draft')) {
          set({ lastAutoRunMonth: currentMonth });
          return null;
        }
        const run = get().runPayroll(currentMonth, employees, { auto: true });
        set({ lastAutoRunMonth: currentMonth });
        return run;
      },
    }),
    { name: 'zenith-payroll' }
  )
);
