/**
 * Income tax on salary (Income-tax Act 2025, s.392) — pure, in paise.
 * Rates come from taxRules.js. The report's method (§7.7):
 *
 *   projected income  salary already paid this tax year + this month + this
 *                     month's contract pay for each month still to come
 *                     + previous-employer salary + other income declared
 *   taxable           − standard deduction (− declared deductions, old regime only)
 *   annual tax        slab tax − rebate (marginal relief just above the limit)
 *                     + surcharge (marginal relief at each threshold) + cess
 *   this month's TDS  (annual tax − TDS already deducted) ÷ months left,
 *                     the last month settling the exact remainder
 *
 * Taxable income and the annual tax are rounded to the nearest ₹10, paise
 * dropped first (Income-tax Act 2025 s.516, which carries over s.288A/288B
 * of the 1961 Act). This month's TDS is rounded to the rupee.
 */
const { mulDiv } = require('./money');

/** Drop the paise, then to the nearest ₹10 — a last digit of 5 or more goes up (s.516). In paise. */
const roundToTenRupees = (paise) => {
  const rupees = Math.floor(Math.max(0, Number(paise) || 0) / 100);
  const last = rupees % 10;
  return (last >= 5 ? rupees + (10 - last) : rupees - last) * 100;
};

/** The old regime's slabs for an age band ('senior' 60–79, 'super_senior' 80+); otherwise the regime's own. */
const slabsFor = (regime, ageBand) => (ageBand && regime.slabsByAge?.[ageBand]) || regime.slabs;

/** Tax by the slabs, exact (income in whole rupees, so every band is exact in paise). */
const slabTax = (income, slabs) => {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    if (income <= lower) break;
    const upper = s.upTo == null ? income : Math.min(income, s.upTo);
    if (upper > lower) tax += mulDiv(upper - lower, s.rate, 100);
    if (s.upTo == null) break;
    lower = s.upTo;
  }
  return tax;
};

/** Slab tax after the rebate (with marginal relief where the regime gives it). */
const taxAfterRebate = (income, regime, ageBand = null) => {
  const base = slabTax(income, slabsFor(regime, ageBand));
  const r = regime.rebate;
  if (!r) return { base, rebate: 0, tax: base };
  if (income <= r.incomeUpTo) {
    const rebate = Math.min(base, r.maxRebate);
    return { base, rebate, tax: base - rebate };
  }
  if (r.marginalRelief && base > income - r.incomeUpTo) {
    // Just above the limit, tax may not exceed the income above it.
    return { base, rebate: base - (income - r.incomeUpTo), tax: income - r.incomeUpTo };
  }
  return { base, rebate: 0, tax: base };
};

/**
 * Tax + surcharge. Marginal relief: above a threshold, tax + surcharge may not
 * exceed the tax + surcharge on the threshold itself plus the income above it.
 */
const taxPlusSurcharge = (income, regime, ageBand = null) => {
  const { tax } = taxAfterRebate(income, regime, ageBand);
  const band = [...regime.surcharge].reverse().find((s) => income > s.above);
  if (!band) return { tax, surcharge: 0 };
  let surcharge = mulDiv(tax, band.rate, 100);
  const atThreshold = taxPlusSurcharge(band.above, regime, ageBand);
  const cap = atThreshold.tax + atThreshold.surcharge + (income - band.above);
  if (tax + surcharge > cap) surcharge = Math.max(0, cap - tax);
  return { tax, surcharge };
};

/**
 * The year's tax on a taxable income (paise) under one regime: income and
 * tax each to the nearest ₹10. ageBand picks the old regime's slabs for
 * people aged 60–79 ('senior') or 80+ ('super_senior').
 */
const annualTax = (taxableIncome, regime, { ageBand = null } = {}) => {
  const income = roundToTenRupees(taxableIncome);
  const { base, rebate } = taxAfterRebate(income, regime, ageBand);
  const { tax, surcharge } = taxPlusSurcharge(income, regime, ageBand);
  const cess = mulDiv(tax + surcharge, regime.cess, 100);
  return {
    taxableIncome: income,
    slabTax: base,
    rebate,
    tax,
    surcharge,
    cess,
    total: roundToTenRupees(tax + surcharge + cess),
  };
};

/**
 * This month's TDS.
 * @param {object} p
 *   rules                  the tax year's rules (taxRules.taxRulesFor)
 *   regime                 'new' (default) | 'old'
 *   monthsLeft             months left in the tax year including this one (≥ 1)
 *   salaryPaidBefore       taxable salary already paid this tax year (published payslips)
 *   thisMonth              this month's taxable salary
 *   futureMonthly          the monthly salary expected for each month still to come
 *   futureTotal            (optional) the salary of all months still to come, when not simply
 *                          futureMonthly × (monthsLeft − 1) — e.g. a leaving month paid in part
 *   tdsBefore              TDS already deducted this tax year (here and by a previous employer)
 *   previousEmployerIncome salary from a previous employer this tax year
 *   otherIncome            other income the employee declared
 *   deductions             old regime only: declared HRA/LTA/80C-type total and PT paid
 *   ageBand                old regime only: 'senior' (60–79) or 'super_senior' (80+)
 */
const monthlyTds = (p) => {
  const regimeKey = p.regime === 'old' ? 'old' : 'new';
  const regime = p.rules.regimes[regimeKey];
  const monthsLeft = Math.max(1, Number(p.monthsLeft) || 1);
  // The months still to come: futureMonthly × (months left − 1), unless the
  // caller worked out the total itself (a leaving month paid only in part).
  const future = p.futureTotal != null
    ? Math.max(0, p.futureTotal)
    : Math.max(0, p.futureMonthly || 0) * (monthsLeft - 1);
  const salary = Math.max(0, p.salaryPaidBefore || 0) + Math.max(0, p.thisMonth || 0)
    + future + Math.max(0, p.previousEmployerIncome || 0);
  const otherIncome = Math.max(0, p.otherIncome || 0);
  // The standard deduction can't be more than the salary itself.
  const standardDeduction = Math.min(regime.standardDeduction, salary);
  const deductions = regime.allowsDeclarations ? Math.max(0, p.deductions || 0) : 0;
  const taxable = Math.max(0, salary + otherIncome - standardDeduction - deductions);
  const ageBand = regimeKey === 'old' ? (p.ageBand || null) : null;
  const tax = annualTax(taxable, regime, { ageBand });
  const alreadyDeducted = Math.max(0, p.tdsBefore || 0);
  const remaining = Math.max(0, tax.total - alreadyDeducted);
  // To the rupee — the last month too (TDS from outside SpaxSync may carry paise).
  const tds = mulDiv(remaining, 1, monthsLeft * 100) * 100;
  return {
    regime: regimeKey,
    projectedSalary: salary,
    otherIncome,
    standardDeduction,
    deductions,
    ...tax,
    annualTax: tax.total,
    alreadyDeducted,
    remaining,
    monthsLeft,
    tds,
  };
};

module.exports = {
  slabTax, taxAfterRebate, taxPlusSurcharge, annualTax, monthlyTds, roundToTenRupees,
};
