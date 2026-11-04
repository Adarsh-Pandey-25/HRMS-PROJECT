/**
 * The statutory values SpaxSync's payroll uses, for the super-admin console
 * (master prompt §6.6: rules are data, with effective dates and sources).
 * Read-only: the values live in backend/src/payroll/ (statutory.js,
 * taxRules.js, gratuity.js, bonusEncashment.js) and change with a reviewed
 * release; each company can still set its own (Settings → Payroll →
 * Calculation). Money is shown in rupees, rates in percent.
 */
const statutory = require('../payroll/statutory');
const { TAX_YEARS } = require('../payroll/taxRules');
const { GRATUITY_RULES } = require('../payroll/gratuity');
const { BONUS_RULES } = require('../payroll/bonusEncashment');

const rupees = (paise) => (paise == null ? null : paise / 100);
const percent = (rate) => (rate ? Number(((rate.num * 100) / rate.den).toFixed(4)) : null);
const ref = (r) => ({
  id: r.id, from: r.from, to: r.to ?? null, source: r.source, status: r.status,
});
const slabRows = (slabs) => (slabs || []).map((s) => ({
  upTo: rupees(s.upTo), amount: rupees(s.amount), februaryAmount: s.februaryAmount != null ? rupees(s.februaryAmount) : null,
}));

const listStatutoryRules = () => ({
  epf: statutory.EPF.map((r) => ({
    ...ref(r),
    wageCeiling: rupees(r.wageCeiling),
    edliWageCeiling: rupees(r.edliWageCeiling),
    employeeRate: percent(r.employeeRate),
    employerRate: percent(r.employerRate),
    epsRate: percent(r.epsRate),
    edliRate: percent(r.edliRate),
    adminRate: percent(r.adminRate),
    adminMinimum: rupees(r.adminMinimumPerEstablishment),
  })),
  esi: statutory.ESI.map((r) => ({
    ...ref(r),
    employeeRate: percent(r.employeeRate),
    employerRate: percent(r.employerRate),
    coverageCeiling: rupees(r.coverageCeiling),
    pwdCoverageCeiling: rupees(r.pwdCoverageCeiling),
    exemptDailyWage: rupees(r.employeeExemptDailyWage),
  })),
  overtime: statutory.OVERTIME.map((r) => ({ ...ref(r), minimumMultiplier: r.minimumMultiplier.num / r.minimumMultiplier.den })),
  professionalTax: statutory.STATES.map((s) => {
    const versions = statutory.PT_TABLES[s.name] || [];
    return {
      code: s.code,
      state: s.name,
      kind: s.pt,
      tables: versions.map((v) => ({
        ...ref(v),
        basis: v.basis,
        slabs: slabRows(v.slabs),
        slabsByGender: v.slabsByGender
          ? Object.fromEntries(Object.entries(v.slabsByGender).map(([g, list]) => [g, slabRows(list)]))
          : null,
      })),
    };
  }),
  incomeTax: TAX_YEARS.map((t) => ({
    ...ref(t),
    taxYear: t.taxYear,
    regimes: Object.fromEntries(Object.entries(t.regimes).map(([key, r]) => [key, {
      standardDeduction: rupees(r.standardDeduction),
      slabs: (r.slabs || []).map((s) => ({ upTo: rupees(s.upTo), rate: s.rate })),
      slabsByAge: r.slabsByAge
        ? Object.fromEntries(Object.entries(r.slabsByAge).map(([band, list]) => [band, list.map((s) => ({ upTo: rupees(s.upTo), rate: s.rate }))]))
        : null,
      rebate: r.rebate ? { incomeUpTo: rupees(r.rebate.incomeUpTo), maxRebate: rupees(r.rebate.maxRebate), marginalRelief: Boolean(r.rebate.marginalRelief) } : null,
      surcharge: (r.surcharge || []).map((s) => ({ above: rupees(s.above), rate: s.rate })),
      cess: r.cess,
      allowsDeclarations: Boolean(r.allowsDeclarations),
    }])),
  })),
  gratuity: GRATUITY_RULES.map((r) => ({
    ...ref(r),
    daysPerYear: r.factor.num,
    divisor: r.factor.den,
    minYears: r.minYears,
    minYearsFixedTerm: r.minYearsFixedTerm,
    ceiling: rupees(r.ceiling),
  })),
  bonus: BONUS_RULES.map((r) => ({
    ...ref(r),
    minPercent: percent(r.minPercent),
    maxPercent: percent(r.maxPercent),
    eligibilityCeiling: rupees(r.eligibilityCeiling),
    calculationCeiling: rupees(r.calculationFloor),
  })),
});

module.exports = { listStatutoryRules };
