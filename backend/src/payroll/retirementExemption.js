/**
 * The tax-free part of what a leaver is paid (audit #14) — pure, in paise.
 * Under both tax regimes, for employees other than government's; the limits
 * and figures are per tax year in taxRules.js (RETIREMENT_EXEMPTIONS).
 *
 * Gratuity (s.10(10)): tax-free up to the least of
 *   - the gratuity paid;
 *   - the statutory gratuity:
 *       covered by the Payment of Gratuity Act (and due under it): 15/26 × the
 *       last drawn Basic + DA × years of service, a part year of more than
 *       six months counting as a year (payroll/gratuity.js);
 *       otherwise: half a month's average Basic + DA (the 10 months before
 *       leaving) × completed years;
 *   - ₹20 lakh, less any exemption already used (a previous employer).
 *
 * Leave encashed on retirement or resignation (s.10(10AA)): tax-free up to
 * the least of
 *   - the encashment paid;
 *   - ₹25 lakh, less any exemption already used;
 *   - 10 × the average monthly Basic + DA of the 10 months before leaving;
 *   - the cash value of the leave encashed, counting at most 30 days for each
 *     completed year of service, at that average ÷ 30 a day.
 * Leave encashed while still employed is taxable in full.
 *
 * Only the rest is taxable: TDS is worked out on it (payroll/tds.js).
 */
const { mulDiv, toPaise } = require('./money');
const { GRATUITY_RULES, serviceLength, computeGratuity } = require('./gratuity');
const { RETIREMENT_EXEMPTIONS } = require('./taxRules');

const paise = (v) => Math.max(0, Math.round(Number(v) || 0));
/** To the nearest rupee, in paise. */
const wholeRupees = (a, num, den) => mulDiv(a, num, den * 100) * 100;

/**
 * @param {object} p
 *   amount          the gratuity paid (paise)
 *   joinedOn, lastWorkingDay  'YYYY-MM-DD'
 *   lastBasicDa     last drawn Basic + DA a month (paise)
 *   averageBasicDa  average monthly Basic + DA of the 10 months before leaving (paise)
 *   covered         covered by the Payment of Gratuity Act (default true)
 *   fixedTerm       a fixed-term employee (due after 1 year, pro rata)
 *   alreadyUsed     gratuity exemption already used, e.g. with a previous employer (paise)
 *   rules           RETIREMENT_EXEMPTIONS of the tax year
 * @returns {{ amount, exempt, taxable, limit, statutory, basis: 'act' | 'not_covered', completedYears }}
 */
const gratuityExemption = ({
  amount, joinedOn, lastWorkingDay, lastBasicDa = 0, averageBasicDa = 0, covered = true, fixedTerm = false,
  alreadyUsed = 0, rules = RETIREMENT_EXEMPTIONS,
}) => {
  const paid = paise(amount);
  const limit = Math.max(0, rules.gratuityLimit - paise(alreadyUsed));
  const service = serviceLength(joinedOn, lastWorkingDay);
  const completedYears = service ? service.years : 0;
  // Due under the Act: its own formula, without the Act's ceiling (the limit above is the tax ceiling).
  const act = covered
    ? computeGratuity({
      joinedOn, lastWorkingDay, monthlyWages: paise(lastBasicDa), fixedTerm, rule: { ...GRATUITY_RULES[0], ceiling: Number.MAX_SAFE_INTEGER },
    })
    : null;
  const basis = act?.eligible ? 'act' : 'not_covered';
  const statutory = basis === 'act'
    ? act.amount
    : wholeRupees(paise(averageBasicDa), rules.gratuityNotCovered.num * completedYears, rules.gratuityNotCovered.den);
  const exempt = Math.min(paid, statutory, limit);
  return {
    amount: paid, exempt, taxable: paid - exempt, limit, statutory, basis, completedYears,
  };
};

/**
 * @param {object} p
 *   amount          the encashment paid (paise)
 *   onLeaving       paid on retirement or resignation (false: while still employed — fully taxable)
 *   leaveDays       days encashed (half days allowed)
 *   completedYears  completed years of service
 *   averageBasicDa  average monthly Basic + DA of the 10 months before leaving (paise)
 *   alreadyUsed     encashment exemption already used, e.g. with a previous employer (paise)
 *   rules           RETIREMENT_EXEMPTIONS of the tax year
 * @returns {{ amount, exempt, taxable, limit, tenMonths, cashValue, daysCounted }}
 */
const leaveEncashmentExemption = ({
  amount, onLeaving = true, leaveDays = 0, completedYears = 0, averageBasicDa = 0, alreadyUsed = 0, rules = RETIREMENT_EXEMPTIONS,
}) => {
  const paid = paise(amount);
  if (!onLeaving) {
    return {
      amount: paid, exempt: 0, taxable: paid, reason: 'Encashed while still employed: taxable in full',
    };
  }
  const average = paise(averageBasicDa);
  const limit = Math.max(0, rules.leaveEncashmentLimit - paise(alreadyUsed));
  const tenMonths = average * rules.averageSalaryMonths;
  const halfDays = Math.max(0, Math.round(Number(leaveDays) * 2) || 0);
  const halfDaysCounted = Math.min(halfDays, rules.leaveDaysPerCompletedYear * Math.max(0, Math.floor(Number(completedYears) || 0)) * 2);
  // A day's average salary is a month's ÷ 30.
  const cashValue = wholeRupees(average, halfDaysCounted, 30 * 2);
  const exempt = Math.min(paid, limit, tenMonths, cashValue);
  return {
    amount: paid, exempt, taxable: paid - exempt, limit, tenMonths, cashValue, daysCounted: halfDaysCounted / 2,
  };
};

/**
 * The tax-free part of a payslip's one-time pay (its config.one_time list,
 * in rupees), in paise: items marked not taxable in full, and the exempt
 * part of the others.
 */
const exemptOneTimePaise = (list) => (Array.isArray(list) ? list : [])
  .filter((i) => i && i.earning)
  .reduce((s, i) => {
    const amount = toPaise(i.amount);
    if (i.taxable === false) return s + amount;
    return s + Math.min(amount, Math.max(0, toPaise(i.exempt)));
  }, 0);

module.exports = { gratuityExemption, leaveEncashmentExemption, exemptOneTimePaise };
