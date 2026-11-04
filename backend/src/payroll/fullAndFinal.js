/**
 * Full and final settlement: what is paid or recovered with a leaver's last
 * payslip besides the month's pay (report §3.4; master prompt Phase 4):
 * gratuity, leave encashment, notice pay and the statutory bonus for the
 * accounting year so far. Final dues are payable within 2 working days of
 * leaving (Code on Wages s.17).
 *
 * Pure: inputs in, items out, money in paise. The company's own values
 * (Settings → Payroll → Calculation: gratuity days, divisor, years and
 * ceiling; bonus %, limits and minimum wage; encashment base and divisor)
 * come in as `calc`; left empty, the law and the standard apply.
 */
const { mulDiv, toPaise } = require('./money');
const { GRATUITY_RULES, computeGratuity } = require('./gratuity');
const { BONUS_RULES, computeEncashment, computeStatutoryBonus } = require('./bonusEncashment');
const { resolveCompanyCalc } = require('./companyRules');

const NOTICE_ACTIONS = ['recover', 'pay', 'waive'];
/** The statutory bonus is 8.33%–20% of bonus wages; more than 20% is ex-gratia, paid as one-time pay. */
const BONUS_MAX_PERCENT = 20;

/**
 * @param {object} p
 *   joinedOn, lastWorkingDay  'YYYY-MM-DD'
 *   fixedTerm                 fixed-term employment (gratuity after 1 year, pro rata)
 *   monthlyBasicDa            Basic + DA a month at leaving (paise)
 *   monthlyWages              Labour Code wages a month at leaving (paise; Basic + DA unless the company counts more)
 *   monthlyGross              contract gross a month (paise)
 *   leaveDays                 leave to encash (half days allowed)
 *   notice                    { requiredDays, servedDays, action: 'recover' | 'pay' | 'waive', base: 'gross' | 'basic_da', divisor }
 *   bonusMonths               [{ wages }] of the accounting year so far (paise), for the statutory bonus; null = none due
 *   calc                      the company's values (payroll_calc)
 * @returns {{ items: [{ code, kind: 'earning' | 'deduction', name, amount, working }], notes: string[] }}
 */
const computeFullAndFinal = ({
  joinedOn, lastWorkingDay, fixedTerm = false, monthlyBasicDa = 0, monthlyWages = 0, monthlyGross = 0,
  leaveDays = 0, notice = null, bonusMonths = null, calc = null,
}) => {
  const c = resolveCompanyCalc(calc);
  const items = [];
  const notes = [];
  const paise = (v) => Math.max(0, Math.round(Number(v) || 0));

  // ── Gratuity: wages × days ÷ divisor × years, after the qualifying years, up to the ceiling ──
  const rule = {
    ...GRATUITY_RULES[0],
    factor: { num: c.gratuity.daysPerYear, den: c.gratuity.divisor },
    minYears: c.gratuity.minYears,
    ceiling: toPaise(c.gratuity.ceiling),
  };
  const wages = paise(monthlyWages) || paise(monthlyBasicDa);
  const g = computeGratuity({ joinedOn, lastWorkingDay, monthlyWages: wages, fixedTerm, rule });
  if (g.eligible && g.amount > 0) {
    items.push({
      code: 'GRATUITY',
      kind: 'earning',
      name: 'Gratuity',
      amount: g.amount,
      working: {
        monthly_wages: wages, days_per_year: rule.factor.num, divisor: rule.factor.den, years: g.countedYears, capped: g.capped,
      },
    });
  } else {
    notes.push(`No gratuity: ${g.reason || 'nothing due'}.`);
  }

  // ── Leave encashment: days × a day's pay (Basic + DA or gross ÷ the divisor) ──
  const days = Math.max(0, Math.round(Number(leaveDays) * 2) / 2 || 0);
  if (days > 0) {
    const base = c.encashment.base === 'gross' ? paise(monthlyGross) : paise(monthlyBasicDa);
    const amount = computeEncashment({ days, monthlyBase: base, divisor: c.encashment.divisor });
    if (amount > 0) {
      items.push({
        code: 'LEAVE_ENCASHMENT',
        kind: 'earning',
        name: 'Leave encashment',
        amount,
        working: { days, monthly_base: base, base: c.encashment.base, divisor: c.encashment.divisor },
      });
    }
  }

  // ── Notice pay: the days of notice not served, recovered (or paid in lieu) ──
  if (notice && NOTICE_ACTIONS.includes(notice.action) && notice.action !== 'waive') {
    const short = Math.max(0, Math.round(Number(notice.requiredDays) || 0) - Math.round(Number(notice.servedDays) || 0));
    const divisor = Math.max(1, Math.round(Number(notice.divisor) || 30));
    const base = notice.base === 'basic_da' ? paise(monthlyBasicDa) : paise(monthlyGross);
    const amount = short > 0 && base > 0 ? mulDiv(base, short, divisor * 100) * 100 : 0;
    if (amount > 0) {
      const recover = notice.action === 'recover';
      items.push({
        code: recover ? 'NOTICE_RECOVERY' : 'NOTICE_PAY',
        kind: recover ? 'deduction' : 'earning',
        name: recover ? 'Notice period not served' : 'Pay in lieu of notice',
        amount,
        working: { days_short: short, monthly_base: base, divisor },
      });
    }
  }

  // ── Statutory bonus for the accounting year so far ──
  if (Array.isArray(bonusMonths) && bonusMonths.length) {
    const percent = Math.min(BONUS_MAX_PERCENT, c.bonus.percent);
    if (c.bonus.percent > BONUS_MAX_PERCENT) notes.push('The bonus above 20% is ex-gratia: add it as one-time pay.');
    const b = computeStatutoryBonus({
      months: bonusMonths.map((m) => ({ wages: paise(m?.wages) })),
      percent: String(percent),
      minimumWage: toPaise(c.bonus.minimumWage || 0),
      rule: {
        ...BONUS_RULES[0],
        eligibilityCeiling: toPaise(c.bonus.eligibilityCeiling),
        calculationFloor: toPaise(c.bonus.calculationCeiling),
      },
    });
    if (b.eligible && b.bonus > 0) {
      items.push({
        code: 'BONUS',
        kind: 'earning',
        name: 'Statutory bonus',
        amount: b.bonus,
        working: { percent, bonus_wages: b.bonusWages, monthly_ceiling: b.ceiling },
      });
    } else {
      notes.push(`No statutory bonus: ${b.reason || 'nothing due'}.`);
    }
  }

  return { items, notes };
};

module.exports = { NOTICE_ACTIONS, computeFullAndFinal };
