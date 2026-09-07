const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Item 5: no central write chokepoint exists in this codebase to hook
 * generically (config/supabase.js's supabaseAdmin is an uninstrumented
 * proxy straight onto the raw client) — this is called explicitly at
 * identified sensitive action points instead. Best-effort: a logging
 * failure must never fail the action it's describing, same reasoning as
 * logCareerEvents elsewhere in this codebase.
 */
const logAudit = async ({ companyId, actorId, actorRole, actionType, targetType, targetId, beforeState, afterState, ipAddress }) => {
  if (!companyId) {
    logger.warn('[AuditLog] Skipped — no companyId', { actionType, targetType, targetId });
    return;
  }
  const { error } = await supabaseAdmin.from('employee_audit_logs').insert({
    company_id: companyId,
    actor_id: actorId || null,
    actor_role: actorRole || 'system',
    actor_type: 'employee',
    action_type: actionType,
    target_type: targetType,
    target_id: targetId || null,
    before_state: beforeState ?? null,
    after_state: afterState ?? null,
    ip_address: ipAddress || null,
  });
  if (error) {
    logger.error('[AuditLog] Failed to write audit log', { actionType, targetType, targetId, error: error.message });
  }
};

/**
 * Same table, super-admin actor. actor_id (FK -> employees) is left null —
 * a super_admins.id would violate that FK — super_admin_actor_id carries
 * attribution instead. is_impersonated marks actions taken while the
 * super-admin is inside an impersonated session, per Module 4/5's
 * requirement that impersonated actions stay attributable to the real actor.
 */
const logSuperAdminAudit = async ({
  companyId, superAdminId, actionType, targetType, targetId,
  beforeState, afterState, ipAddress, isImpersonated = false,
}) => {
  if (!companyId) {
    logger.warn('[AuditLog] Skipped super-admin log — no companyId', { actionType, targetType, targetId });
    return;
  }
  const { error } = await supabaseAdmin.from('employee_audit_logs').insert({
    company_id: companyId,
    actor_id: null,
    actor_role: 'super_admin',
    actor_type: 'super_admin',
    super_admin_actor_id: superAdminId || null,
    is_impersonated: Boolean(isImpersonated),
    action_type: actionType,
    target_type: targetType,
    target_id: targetId || null,
    before_state: beforeState ?? null,
    after_state: afterState ?? null,
    ip_address: ipAddress || null,
  });
  if (error) {
    logger.error('[AuditLog] Failed to write super-admin audit log', { actionType, targetType, targetId, error: error.message });
  }
};

/** Paginated, filterable read for the super-admin/HR-facing viewer page. */
const listAuditLogs = async (companyId, { page = 1, limit = 20, actorId, actionType, targetType, from, to } = {}) => {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from('employee_audit_logs')
    .select('*, actor:actor_id(id, first_name, last_name, email)', { count: 'exact' })
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (actorId) query = query.eq('actor_id', actorId);
  if (actionType) query = query.eq('action_type', actionType);
  if (targetType) query = query.eq('target_type', targetType);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data || [], total: count || 0 };
};

/**
 * For super-admin actions with no company to scope to at all (admin-user
 * management: create/deactivate/reassign role) — company_id is genuinely
 * null here, not omitted by mistake. Kept separate from logSuperAdminAudit
 * so that function's existing "refuse without a companyId" guard (Item 5:
 * never a silent unscoped company-audit row) stays intact for every
 * company-scoped call site.
 */
const logPlatformAudit = async ({ superAdminId, actionType, targetType, targetId, beforeState, afterState, ipAddress }) => {
  const { error } = await supabaseAdmin.from('employee_audit_logs').insert({
    company_id: null,
    actor_id: null,
    actor_role: 'super_admin',
    actor_type: 'super_admin',
    super_admin_actor_id: superAdminId || null,
    action_type: actionType,
    target_type: targetType,
    target_id: targetId || null,
    before_state: beforeState ?? null,
    after_state: afterState ?? null,
    ip_address: ipAddress || null,
  });
  if (error) {
    logger.error('[AuditLog] Failed to write platform audit log', { actionType, targetType, targetId, error: error.message });
  }
};

module.exports = { logAudit, logSuperAdminAudit, logPlatformAudit, listAuditLogs };
