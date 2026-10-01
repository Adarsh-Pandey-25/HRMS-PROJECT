/**
 * Who approves leave and expense requests — mirrors the server's rules
 * (backend/src/services/approvalFlow.service.js) so each approval page shows
 * a request in the queue of whoever's turn it is.
 *
 *   manager-only     the employee's manager decides; their approval is final
 *   manager-then-hr  the manager approves first, then HR finalizes
 *   hr-only          HR decides; managers can neither approve nor reject
 *
 * A request from someone with no manager is always HR's.
 */
export const APPROVAL_FLOW_OPTIONS = [
  { value: 'manager-only', label: 'Manager only', hint: "The employee's manager approves — that decision is final." },
  { value: 'manager-then-hr', label: 'Manager → HR', hint: 'The manager approves first, then HR gives the final approval.' },
  { value: 'hr-only', label: 'HR only', hint: 'HR approves every request. Managers are not asked and cannot approve or reject.' },
];

/** Leave stores its flow as approval_level: 'single' | 'two-level' | 'hr-only'. */
export const LEAVE_LEVEL_FOR_FLOW = { 'manager-only': 'single', 'manager-then-hr': 'two-level', 'hr-only': 'hr-only' };

export function normalizeFlow(raw, fallback = 'manager-then-hr') {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (['single', 'manager-only', 'manager'].includes(v)) return 'manager-only';
  if (['two-level', 'two', 'manager-then-hr', 'manager-hr'].includes(v)) return 'manager-then-hr';
  if (['hr-only', 'hr'].includes(v)) return 'hr-only';
  return fallback;
}

/** Whose turn a pending request is: 'manager' or 'hr'. */
export function awaitingStage(flow, { hasManager, managerApproved }) {
  if (flow === 'hr-only' || !hasManager) return 'hr';
  if (flow === 'manager-only') return 'manager';
  return managerApproved ? 'hr' : 'manager';
}
