/**
 * HR can't act on their own pay — an Admin must (audit #3). One place for the
 * rule, so every payroll action says the same thing:
 *  - someone who isn't an Admin acting on their own payslip (generate,
 *    recalculate, publish, approve, mark paid, one-time pay, full and final)
 *    is refused;
 *  - an Admin acting on their own is allowed, and it is written to the audit log;
 *  - bulk actions skip the person's own payslip instead of refusing the batch.
 */
const { ForbiddenError } = require('../utils/errors');

const OWN_PAYSLIP_MESSAGE = 'Your own payslip has to be handled by an Admin.';

/** Same id, whatever the letter case (ids can arrive in upper or lower case). */
const sameId = (a, b) => a != null && b != null && a !== '' && b !== ''
  && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const isAdmin = (actor) => String(actor?.role || '').toLowerCase() === 'admin';
const isOwnPay = (actor, employeeId) => sameId(actor?.id, employeeId);
/** A bulk action leaves this payslip out: it is the actor's own and they aren't an Admin. */
const skipsOwnPay = (actor, employeeId) => isOwnPay(actor, employeeId) && !isAdmin(actor);

/**
 * Refuses someone who isn't an Admin acting on their own pay. Returns true
 * when an Admin acts on their own (the caller then audit-logs it), else false.
 */
const assertNotOwnPay = (actor, employeeId, message = OWN_PAYSLIP_MESSAGE) => {
  if (!isOwnPay(actor, employeeId)) return false;
  if (!isAdmin(actor)) throw new ForbiddenError(message);
  return true;
};

/** Writes an Admin's action on their own pay to the audit log. Never throws. */
const logOwnPayAction = (actor, action, details = {}, ipAddress = null) => {
  Promise.resolve()
    .then(() => require('./auditLog.service').logAudit({
      companyId: actor?.company_id || null,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      actionType: `payroll.own_pay.${action}`,
      targetType: 'employee',
      targetId: actor?.id || null,
      afterState: details,
      ipAddress,
    }))
    .catch(() => {});
};

module.exports = {
  OWN_PAYSLIP_MESSAGE, sameId, isAdmin, isOwnPay, skipsOwnPay, assertNotOwnPay, logOwnPayAction,
};
