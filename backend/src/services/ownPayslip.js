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

const PRIVILEGED_PAY_MESSAGE = 'Only an Admin can change the pay of HR and Admin users.';
const PRIVILEGED_ROLES = ['hr', 'admin'];

/**
 * Owner's rule (17 Nov 2026): the pay of an HR or Admin user — salary and
 * bank details, revisions, one-time pay, loans, payroll setup, tax
 * declarations, full and final — is changed only by an Admin, so HR users
 * can't change each other's pay. Your own pay is assertNotOwnPay's job.
 * Pass `targetRole` when the caller already has the row; otherwise it is
 * looked up. A refusal is audit-logged.
 */
const assertMayChangePayOf = async (actor, employeeId, targetRole, ipAddress = null) => {
  if (!actor || actor.role === 'system' || isAdmin(actor)) return;
  if (!employeeId || isOwnPay(actor, employeeId)) return;
  let role = targetRole;
  if (role === undefined) {
    const { supabaseAdmin } = require('../config/supabase');
    const { data, error } = await supabaseAdmin
      .from('employees').select('role').eq('id', employeeId).maybeSingle();
    if (error) throw new ForbiddenError('Could not check whose pay this is. Please try again.');
    role = data?.role;
  }
  if (!PRIVILEGED_ROLES.includes(String(role || '').toLowerCase())) return;
  Promise.resolve()
    .then(() => require('./auditLog.service').logAudit({
      companyId: actor.company_id || null,
      actorId: actor.id || null,
      actorRole: actor.role || null,
      actionType: 'payroll.privileged_pay_refused',
      targetType: 'employee',
      targetId: employeeId,
      afterState: { targetRole: role },
      ipAddress,
    }))
    .catch(() => {});
  throw new ForbiddenError(PRIVILEGED_PAY_MESSAGE);
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
  OWN_PAYSLIP_MESSAGE, PRIVILEGED_PAY_MESSAGE, sameId, isAdmin, isOwnPay, skipsOwnPay, assertNotOwnPay,
  assertMayChangePayOf, logOwnPayAction,
};
