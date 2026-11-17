/**
 * The limit on a month's total deductions (Code on Wages, 2019 s.18; Wages
 * (Central) Rules r.13): together they may not be more than 50% of the
 * month's wages, and what is held back is recovered in later months. The
 * share and the wages it is of are the company's choice (companyRules
 * deductionCap; the CA confirms which wages). Pure, in paise.
 *
 * Statutory deductions — employee PF (with the VPF the employee chose), ESI,
 * Professional Tax, LWF and TDS — are never reduced. When the total would
 * pass the limit the others are reduced until it equals the limit (to
 * nothing, if the statutory ones alone reach it), in this order:
 *   1. loan and salary-advance instalments: what isn't recovered stays on the
 *      loan's balance, so it carries forward with nothing new to record;
 *   2. one-time recoveries (notice not served, other recoveries): the rest is
 *      added to next month's payslip when this one is published;
 *   3. the company's own monthly deductions, last: a recurring deduction has
 *      nowhere to carry to, so its shortfall is only reported.
 * Whatever the limit, no deduction takes more than the pay left (as before).
 *
 * A full and final settlement isn't held to the limit — nothing can be
 * carried past the last payslip — so it is reported when over it instead.
 */
const { rateRupees, sum } = require('./money');

/**
 * @param {object} p
 *   pay          the month's pay (gross, paise): deductions never take more than it
 *   base         the wages the limit is a share of (paise)
 *   rate         the limit as a fraction of 1 ({ num, den }); null = no limit
 *   statutory    the statutory deductions together (paise), never reduced
 *   configured   [{ key, name, amount }] the company's own deductions
 *   oneTime      [{ key, name, amount }] one-time recoveries
 *   loans        [{ key, name, amount }] loan and advance instalments due
 *   finalPay     a leaver's final payslip: reported against the limit, not held to it
 * @returns {{ limit, applies, statutory, due, total, overLimit, heldByLimit,
 *   configured, oneTime, loans }} — each line { ...input, due, amount (taken),
 *   held, reason: 'limit' | 'pay' | null }
 */
const applyDeductionCap = ({
  pay, base, rate, statutory = 0, configured = [], oneTime = [], loans = [], finalPay = false,
}) => {
  const limit = rate ? rateRupees(Math.max(0, base || 0), rate, 'down') : null;
  const applies = limit != null && !finalPay;
  let budget = applies ? Math.max(0, limit - statutory) : Infinity;
  let room = Math.max(0, (pay || 0) - statutory);
  const take = (list, { inFull = false } = {}) => (Array.isArray(list) ? list : []).map((d) => {
    const due = Math.max(0, Math.round(Number(d.amount) || 0));
    // Without a limit the company's own deductions are taken as set (a payslip
    // whose deductions pass its pay is refused); the rest take what pay is left.
    const amount = inFull && !applies ? due : Math.min(due, room, budget);
    const held = due - amount;
    const reason = held > 0 ? (applies && budget <= room ? 'limit' : 'pay') : null;
    room = Math.max(0, room - amount);
    if (applies) budget -= amount;
    return {
      ...d, due, amount, held, reason,
    };
  });
  const configuredOut = take(configured, { inFull: true });
  const oneTimeOut = take(oneTime);
  const loansOut = take(loans);
  const lines = [...configuredOut, ...oneTimeOut, ...loansOut];
  const total = statutory + sum(lines.map((l) => l.amount));
  return {
    limit,
    applies,
    statutory,
    due: statutory + sum(lines.map((l) => l.due)),
    total,
    // A final payslip (not held to the limit): how far its deductions pass it.
    overLimit: limit != null && !applies ? Math.max(0, total - limit) : 0,
    heldByLimit: sum(lines.filter((l) => l.reason === 'limit').map((l) => l.held)),
    configured: configuredOut,
    oneTime: oneTimeOut,
    loans: loansOut,
  };
};

module.exports = { applyDeductionCap };
