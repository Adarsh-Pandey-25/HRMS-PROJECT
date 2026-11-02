const settingsService = require('./settings.service');
const { DEFAULT_COMPANY_ID } = require('../utils/tenant');

/**
 * Who approves a request — one set of rules for leave, work from home and
 * expenses, chosen per request type in Settings → Approval Flows.
 *
 *   manager-only     the employee's manager decides; their approval is final
 *   manager-then-hr  the manager approves first, then HR finalizes
 *   hr-only          HR decides; managers can neither approve nor reject
 *   manager-or-hr    the manager and HR are asked at the same time; whoever
 *                    decides first settles it (owner's decision, 2 Nov 2026)
 *
 * In every flow, a request from someone with no manager goes to HR, and HR /
 * Admin can always act (in manager-then-hr, only once the manager has
 * approved). Nobody can approve or reject their own request.
 *
 * Stored as leave_policy_meta.approval_level ('single' | 'two-level' |
 * 'hr-only' | 'manager-or-hr' — the first two kept for existing data),
 * expense_config.approvalFlow and approval_flows.wfh.
 */
const FLOWS = ['manager-only', 'manager-then-hr', 'hr-only', 'manager-or-hr'];

const normalizeFlow = (raw, fallback) => {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (['single', 'manager-only', 'manager'].includes(v)) return 'manager-only';
  if (['two-level', 'two', 'manager-then-hr', 'manager-hr'].includes(v)) return 'manager-then-hr';
  if (['hr-only', 'hr'].includes(v)) return 'hr-only';
  if (['manager-or-hr', 'either'].includes(v)) return 'manager-or-hr';
  return fallback;
};

const getLeaveFlow = async (companyId) => {
  const meta = await settingsService.getSetting('leave_policy_meta', null, companyId || DEFAULT_COMPANY_ID);
  return normalizeFlow(meta?.approval_level ?? meta?.approvalLevel, 'manager-only');
};

const getExpenseFlow = async (companyId) => {
  const cfg = await settingsService.getSetting('expense_config', null, companyId || DEFAULT_COMPANY_ID);
  return normalizeFlow(cfg?.approvalFlow ?? cfg?.approval_flow, 'manager-then-hr');
};

// Until a company chooses, work from home goes to the manager and HR at once,
// as it did before it had a setting (owner's decision, 30 Oct 2026).
const getWfhFlow = async (companyId) => {
  const flows = await settingsService.getSetting('approval_flows', null, companyId || DEFAULT_COMPANY_ID);
  return normalizeFlow(flows?.wfh, 'manager-or-hr');
};

/** Whose turn it is on a pending request: 'manager', 'hr', or 'any' (either may decide). */
const awaitingStage = (flow, { hasManager, managerApproved }) => {
  if (flow === 'hr-only' || !hasManager) return 'hr';
  if (flow === 'manager-only') return 'manager';
  if (flow === 'manager-or-hr') return 'any';
  return managerApproved ? 'hr' : 'manager';
};

/** Is a request at this stage in `who`'s queue ('manager' or 'hr')? */
const isTurnOf = (stage, who) => stage === who || stage === 'any';

const isHrRole = (role) => role === 'hr' || role === 'admin';

/**
 * What an approval by this person does: { ok: true, final } — final=false
 * is the manager step of manager-then-hr — or { ok: false, status, message }.
 */
const decideApproval = (flow, {
  actorId, employeeId, actorRole, managesEmployee, hasManager, managerApproved, what = 'request',
}) => {
  if (actorId && employeeId && String(actorId) === String(employeeId)) {
    return { ok: false, status: 403, message: `You cannot approve your own ${what}` };
  }
  if (isHrRole(actorRole)) {
    if (flow === 'manager-then-hr' && hasManager && !managerApproved) {
      return { ok: false, status: 400, message: `The manager must approve this ${what} before HR` };
    }
    return { ok: true, final: true };
  }
  if (!managesEmployee) return { ok: false, status: 403, message: `Not authorized to approve this ${what}` };
  if (flow === 'hr-only') return { ok: false, status: 403, message: `In your company, every ${what} is approved by HR` };
  return { ok: true, final: flow !== 'manager-then-hr' };
};

const decideRejection = (flow, { actorId, employeeId, actorRole, managesEmployee, what = 'request' }) => {
  if (actorId && employeeId && String(actorId) === String(employeeId)) {
    return { ok: false, status: 403, message: `You cannot reject your own ${what}` };
  }
  if (isHrRole(actorRole)) return { ok: true };
  if (!managesEmployee) return { ok: false, status: 403, message: `Not authorized to reject this ${what}` };
  if (flow === 'hr-only') return { ok: false, status: 403, message: `In your company, every ${what} is decided by HR` };
  return { ok: true };
};

module.exports = {
  FLOWS,
  normalizeFlow,
  getLeaveFlow,
  getExpenseFlow,
  getWfhFlow,
  awaitingStage,
  isTurnOf,
  decideApproval,
  decideRejection,
  isHrRole,
};
