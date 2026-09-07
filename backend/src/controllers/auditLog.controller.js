const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

/** HR/Admin — scoped to their own company only. */
const list = async (req, res, next) => {
  try {
    const companyId = req.user.company_id || getCompanyId(req.user);
    const { page, limit } = paginate(req.query);
    const { data, total } = await auditLogService.listAuditLogs(companyId, {
      page, limit,
      actorId: req.query.actor_id,
      actionType: req.query.action_type,
      targetType: req.query.target_type,
      from: req.query.from,
      to: req.query.to,
    });
    successResponse(res, 'Audit logs fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

module.exports = { list };
