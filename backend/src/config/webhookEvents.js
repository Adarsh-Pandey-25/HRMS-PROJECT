/**
 * Item 5: real event catalog for outbound webhooks. Each key is dispatched
 * from exactly one real backend action already in this codebase — see the
 * call site noted per event. "attendance.regularization_approved/rejected"
 * from the original spec was swapped for helpdesk.ticket_resolved:
 * regularization here is implemented as a specially-tagged helpdesk ticket
 * (see lib/regularization.js on the frontend), not a distinct approval
 * action with its own accept/reject state — ticket resolution is the real,
 * unambiguous action that actually occurs.
 */
const WEBHOOK_EVENTS = {
  'employee.created': { label: 'Employee created', source: 'employee.controller.js create()' },
  'employee.offboarded': { label: 'Employee offboarded', source: 'employee.controller.js offboard()' },
  'leave.applied': { label: 'Leave applied', source: 'leave.controller.js apply()' },
  'leave.approved': { label: 'Leave approved', source: 'leave.controller.js approve()' },
  'leave.rejected': { label: 'Leave rejected', source: 'leave.controller.js reject()' },
  'payroll.payslip_published': { label: 'Payslip published', source: 'payroll.service.js publishPayslip()' },
  'helpdesk.ticket_resolved': { label: 'Helpdesk ticket resolved', source: 'helpdesk.controller.js updateStatus()' },
  'asset.assigned': { label: 'Asset assigned', source: 'assets.controller.js assign()' },
};

const WEBHOOK_EVENT_KEYS = Object.keys(WEBHOOK_EVENTS);

module.exports = { WEBHOOK_EVENTS, WEBHOOK_EVENT_KEYS };
