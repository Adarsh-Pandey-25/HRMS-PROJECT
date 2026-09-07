const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const auditLogService = require('./auditLog.service');
const logger = require('../utils/logger');

const TTL_MINUTES = 45;

/**
 * Module 4: issues a normal employee-scoped access token (verified by the
 * same auth.middleware.js path as a real login) plus an `is_impersonation`
 * claim and a hard TTL — jwt.verify rejects it the instant that TTL passes,
 * with no reliance on the frontend to enforce it. No refresh token is
 * issued: when the window closes the super-admin must explicitly start a
 * new session rather than silently renewing one.
 */
const startImpersonation = async (superAdminId, superAdminEmail, companyId, reason, ipAddress) => {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new BadRequestError('A reason is required to impersonate a user');

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();
  if (companyError) throw new BadRequestError(companyError.message);
  if (!company) throw new NotFoundError('Company not found');

  // Target the company's designated admin — the same "who's the admin
  // contact" resolution Module 2's company profile uses.
  const { data: admin, error: adminError } = await supabaseAdmin
    .from('employees')
    .select('id, email, role, token_version, first_name, last_name')
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (adminError) throw new BadRequestError(adminError.message);
  if (!admin) throw new NotFoundError('This company has no active admin account to impersonate');

  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('impersonation_sessions')
    .insert({
      super_admin_id: superAdminId,
      company_id: companyId,
      target_employee_id: admin.id,
      reason: cleanReason,
      ip_address: ipAddress || null,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();
  if (sessionError) throw new BadRequestError(sessionError.message);

  const token = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      company_id: companyId,
      token_version: admin.token_version ?? 0,
      typ: 'impersonation',
      superAdminId,
      superAdminEmail,
      sessionId: session.id,
      companyName: company.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: `${TTL_MINUTES}m` },
  );

  await auditLogService.logSuperAdminAudit({
    companyId,
    superAdminId,
    actionType: 'impersonation_started',
    targetType: 'employee',
    targetId: admin.id,
    afterState: { reason: cleanReason, targetEmail: admin.email, expiresAt: expiresAt.toISOString() },
    ipAddress,
  });
  logger.info('[Impersonation] Started', { superAdminId, companyId, targetEmployeeId: admin.id, sessionId: session.id });

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    company: { id: company.id, name: company.name },
    targetEmployee: { id: admin.id, email: admin.email, name: `${admin.first_name} ${admin.last_name}`.trim() },
  };
};

const endImpersonation = async (sessionId, superAdminId, companyId, ipAddress) => {
  if (!sessionId) throw new BadRequestError('sessionId is required');
  const { data, error } = await supabaseAdmin
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('ended_at', null)
    .select('id, company_id, target_employee_id')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) return { ended: false };

  await auditLogService.logSuperAdminAudit({
    companyId: companyId || data.company_id,
    superAdminId,
    actionType: 'impersonation_ended',
    targetType: 'employee',
    targetId: data.target_employee_id,
    ipAddress,
  });
  return { ended: true };
};

const listActiveSessions = async () => {
  const { data, error } = await supabaseAdmin
    .from('impersonation_sessions')
    .select('*, companies(id, name), employees:target_employee_id(id, first_name, last_name, email)')
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

module.exports = { startImpersonation, endImpersonation, listActiveSessions };
