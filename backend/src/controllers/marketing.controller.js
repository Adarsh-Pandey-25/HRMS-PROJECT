const marketingService = require('../services/marketing.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');

// ── Public (apex marketing site) ────────────────────────────────────────────

const listPlans = async (req, res, next) => {
  try {
    const plans = await marketingService.listPublicPlans();
    res.set('Cache-Control', 'public, max-age=300');
    successResponse(res, 'Plans fetched', plans);
  } catch (err) { next(err); }
};

const GENERIC_LEAD_RESPONSE = 'Thanks — we have received your request and will be in touch shortly.';

const submitLead = async (req, res, next) => {
  try {
    // Honeypot: a hidden field real visitors never fill. Bots that do get the
    // same success response, and nothing is stored or emailed.
    if (req.body.website) {
      return successResponse(res, GENERIC_LEAD_RESPONSE, null, null, 201);
    }
    await marketingService.createLead(req.body, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    successResponse(res, GENERIC_LEAD_RESPONSE, null, null, 201);
  } catch (err) { next(err); }
};

// ── Super-admin ─────────────────────────────────────────────────────────────

const listLeads = async (req, res, next) => {
  try {
    const { page, limit } = paginate(req.query);
    const { data, total } = await marketingService.listLeads({
      page, limit, status: req.query.status, type: req.query.type,
    });
    successResponse(res, 'Leads fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

const updateLeadStatus = async (req, res, next) => {
  try {
    const { before, after } = await marketingService.updateLeadStatus(req.params.id, req.body.status);
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id,
      actionType: 'lead_status_changed',
      targetType: 'marketing_lead',
      targetId: req.params.id,
      beforeState: { status: before.status },
      afterState: { status: after.status },
      ipAddress: req.ip,
    });
    successResponse(res, 'Lead updated', after);
  } catch (err) { next(err); }
};

const inviteFromLead = async (req, res, next) => {
  try {
    const result = await marketingService.inviteFromLead(req.superAdmin.id, req.params.id, {
      companyName: req.body.company_name || req.body.companyName,
      slug: req.body.slug,
      expiresInDays: req.body.expires_in_days || req.body.expiresInDays,
    });
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id,
      actionType: 'lead_invited',
      targetType: 'marketing_lead',
      targetId: req.params.id,
      afterState: {
        inviteId: result.invite.invite.id,
        email: result.invite.invite.email,
        companySlug: result.invite.companySlug,
      },
      ipAddress: req.ip,
    });
    successResponse(res, 'Invite sent', {
      lead: result.lead,
      inviteUrl: result.invite.inviteUrl,
      companySlug: result.invite.companySlug,
      expiresAt: result.invite.expiresAt,
    }, null, 201);
  } catch (err) { next(err); }
};

module.exports = {
  listPlans, submitLead, listLeads, updateLeadStatus, inviteFromLead,
};
