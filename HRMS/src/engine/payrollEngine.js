/**
 * Payroll calculation engine.
 *
 * Pure, side-effect-free functions that turn an employee's salary structure +
 * the company payroll config into a fully-computed monthly payroll record.
 * The store adapter (payrollStore.computeMonthSheet) feeds these functions the
 * live `payrollConfig` from settingsStore and maps the result onto the salary
 * sheet shape the rest of the app already consumes.
 *
 * Adapted to THIS app's data model:
 *   - earnings come from employee.salary { basic, hra, da, special }
 *   - there is no historical attendance store, so LOP days are supplied by the
 *     caller (status-derived) rather than reconstructed from attendance.
 *   - output keys match the existing sheet contract exactly:
 *       earnings   { basic, hra, da, specialAllowance, incentive, gross }
 *       deductions { pf, esic, pt, tds, advance, total }
 */

// ── Income-tax slabs (annual, FY2024-25 onward) ──────────────────────────────
const TAX_SLABS = {
  new: [
    { upTo: 300000, rate: 0 },
    { upTo: 700000, rate: 5 },
    { upTo: 1000000, rate: 10 },
    { upTo: 1200000, rate: 15 },
    { upTo: 1500000, rate: 20 },
    { upTo: Infinity, rate: 30 },
  ],
  old: [
    { upTo: 250000, rate: 0 },
    { upTo: 500000, rate: 5 },
    { upTo: 1000000, rate: 20 },
    { upTo: Infinity, rate: 30 },
  ],
};
// Income at/below this (after standard deduction) pays no tax (rebate u/s 87A).
const REBATE_CEILING = { new: 700000, old: 500000 };
const CESS_RATE = 0.04; // 4% Health & Education Cess

// ── Earnings ─────────────────────────────────────────────────────────────────
/**
 * Build the earnings breakdown from the employee's fixed salary structure,
 * honouring the company's enabled components. `incentive` is an optional manual
 * add-on (kept for parity with the existing sheet shape).
 */
export function calculateEarnings(salary, config = {}, incentive = 0) {
  const components = config.components || {};
  const on = (key) => components[key] !== false; // default enabled

  const basic = salary.basic || 0;
  const hra = on('hra') ? salary.hra || 0 : 0;
  const da = on('da') ? salary.da || 0 : 0;
  const specialAllowance = on('special') ? salary.special || 0 : 0;
  const inc = Math.round(incentive || 0);
  const gross = basic + hra + da + specialAllowance + inc;

  return { basic, hra, da, specialAllowance, incentive: inc, gross };
}

// ── Loss of Pay ──────────────────────────────────────────────────────────────
/**
 * LOP amount for a given number of LOP days. Working days basis defaults to 30
 * (the standard this app displays); pass a different basis to change it.
 */
export function calculateLOP({ grossSalary, lopDays = 0, workingDays = 30 }) {
  const days = Math.max(0, lopDays);
  const lopPerDay = workingDays > 0 ? grossSalary / workingDays : 0;
  const lopAmount = Math.round(lopPerDay * days);
  return {
    workingDays,
    daysWorked: workingDays - days,
    lopDays: days,
    lopAmount,
    lopPerDay,
  };
}

// ── Professional Tax ─────────────────────────────────────────────────────────
export function getPTAmount(gross, slabs) {
  if (!slabs || slabs.length === 0) return 0;
  const slab = slabs.find((s) => gross >= s.min && gross <= (s.max ?? Infinity));
  return slab?.amount || 0;
}

// ── TDS (income tax) ─────────────────────────────────────────────────────────
function slabTax(income, slabs) {
  let tax = 0;
  let lower = 0;
  for (const { upTo, rate } of slabs) {
    if (income <= lower) break;
    const taxableInSlab = Math.min(income, upTo) - lower;
    tax += taxableInSlab * (rate / 100);
    lower = upTo;
  }
  return tax;
}

/**
 * Monthly TDS from annual gross, using the configured regime, standard
 * deduction, 87A rebate and 4% cess.
 */
export function calculateTDS({ annualGross, regime = 'new', standardDeduction = 75000 }) {
  const slabs = TAX_SLABS[regime] || TAX_SLABS.new;
  const taxable = Math.max(0, annualGross - standardDeduction);
  if (taxable <= (REBATE_CEILING[regime] ?? 0)) return 0;
  const annualTax = Math.round(slabTax(taxable, slabs) * (1 + CESS_RATE));
  return Math.round(annualTax / 12);
}

// ── Statutory + custom deductions ────────────────────────────────────────────
/**
 * Returns the deductions breakdown in the app's sheet shape plus the employer
 * contributions (exposed separately for CTC/analytics; not part of `total`).
 */
export function calculateDeductions({ basic, gross, config, tdsOverride }) {
  const pfCeiling = config.pfWageCeiling; // null → PF on full basic
  const pfWage = pfCeiling ? Math.min(basic, pfCeiling) : basic;
  const pf = Math.round(pfWage * ((config.pfEmployeePercent ?? 12) / 100));
  const employerPf = Math.round(pfWage * ((config.pfEmployerPercent ?? 12) / 100));

  const underEsiThreshold = gross <= (config.esiThreshold ?? 21000);
  const esic = underEsiThreshold ? Math.round(gross * ((config.esiEmployeePercent ?? 0.75) / 100)) : 0;
  const employerEsi = underEsiThreshold ? Math.round(gross * ((config.esiEmployerPercent ?? 3.25) / 100)) : 0;

  const pt = getPTAmount(gross, config.ptSlabs);

  const tds =
    config.tdsMode === 'manual'
      ? Math.round(tdsOverride || 0)
      : calculateTDS({
          annualGross: gross * 12,
          regime: config.tdsRegime || 'new',
          standardDeduction: config.standardDeduction ?? 75000,
        });

  const advance = 0; // manual recovery, entered per-employee when needed
  const total = pf + esic + pt + tds + advance;

  return { pf, esic, pt, tds, advance, total, employerPf, employerEsi };
}

// ── New-joiner / exit proration ──────────────────────────────────────────────
/** Prorated gross when an employee works only part of the month. */
export function calculateProration({ grossSalary, daysWorked, workingDays = 30 }) {
  if (daysWorked >= workingDays) return grossSalary;
  return Math.round((grossSalary / workingDays) * Math.max(0, daysWorked));
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
/**
 * Full payroll for one employee for one month, in the existing sheet shape.
 *
 * @param {object}  employee      – app employee (uses .id, .salary, .status)
 * @param {string}  month         – 'YYYY-MM'
 * @param {object}  config        – settingsStore.payrollConfig
 * @param {number}  [lopDays]     – LOP days for the month (caller-derived)
 * @param {number}  [incentive]   – optional manual incentive
 * @param {number}  [tdsOverride] – used only when config.tdsMode === 'manual'
 */
export function calculateEmployeePayroll({ employee, month, config, lopDays = 0, incentive = 0, tdsOverride = 0 }) {
  const workingDays = 30; // this app standardises on a 30-day basis
  const earnings = calculateEarnings(employee.salary, config, incentive);

  const lop = calculateLOP({ grossSalary: earnings.gross, lopDays, workingDays });

  // Statutory dues are computed on the contractual gross (LOP reduces take-home
  // via lopAmount, not the statutory base — matching common Indian practice).
  const deductions = calculateDeductions({
    basic: earnings.basic,
    gross: earnings.gross,
    config,
    tdsOverride,
  });

  const netPay = Math.round(earnings.gross - lop.lopAmount - deductions.total);

  return {
    id: `PAY-${month}-${employee.id.split('-')[1]}`,
    employeeId: employee.id,
    month,
    daysInMonth: workingDays,
    daysWorked: lop.daysWorked,
    lopDays: lop.lopDays,
    lopAmount: lop.lopAmount,
    earnings,
    deductions: {
      pf: deductions.pf,
      esic: deductions.esic,
      pt: deductions.pt,
      tds: deductions.tds,
      advance: deductions.advance,
      total: deductions.total,
    },
    employerPf: deductions.employerPf,
    employerEsi: deductions.employerEsi,
    netPay,
    status: 'processed',
    isNewJoinee: employee.status === 'probation',
  };
}

export default calculateEmployeePayroll;
