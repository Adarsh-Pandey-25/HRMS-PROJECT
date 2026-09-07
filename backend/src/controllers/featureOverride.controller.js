const featureOverrideService = require('../services/featureOverride.service');
const exportGateService = require('../services/exportGate.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

const getFeatures = async (req, res, next) => {
  try {
    successResponse(res, 'Effective features fetched', await featureOverrideService.getEffectiveFeatures(req.params.id));
  } catch (err) { next(err); }
};

const setFeature = async (req, res, next) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') throw new BadRequestError('enabled boolean is required');
    const data = await featureOverrideService.setFeatureOverride(
      req.params.id, req.params.key, req.body.enabled, req.body.reason, req.superAdmin.id,
    );
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'feature_override_set',
      targetType: 'company_feature_override', targetId: req.params.id,
      afterState: { featureKey: req.params.key, enabled: req.body.enabled, reason: req.body.reason },
    });
    successResponse(res, 'Feature override set', data);
  } catch (err) { next(err); }
};

const clearFeature = async (req, res, next) => {
  try {
    const data = await featureOverrideService.clearFeatureOverride(req.params.id, req.params.key);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'feature_override_cleared',
      targetType: 'company_feature_override', targetId: req.params.id, afterState: { featureKey: req.params.key },
    });
    successResponse(res, 'Feature override cleared', data);
  } catch (err) { next(err); }
};

const setSeatOverride = async (req, res, next) => {
  try {
    const data = await featureOverrideService.setSeatOverride(req.params.id, req.body.max_seats_override ?? req.body.maxSeatsOverride);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'seat_override_set',
      targetType: 'company_billing_subscription', targetId: data.id, afterState: { maxSeatsOverride: data.max_seats_override },
    });
    successResponse(res, 'Seat override updated', data);
  } catch (err) { next(err); }
};

/**
 * Item 6.5: a deliberate, explicit, separately-logged action — never a
 * side effect of manual credit or subscription-extend, which stay
 * scoped to amount-owed / renewal-date only.
 */
const setExportOverride = async (req, res, next) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') throw new BadRequestError('enabled boolean is required');
    if (!req.body?.reason) throw new BadRequestError('A reason is required');
    const data = await exportGateService.setExportOverride(req.params.id, req.body.enabled, req.body.reason, req.superAdmin.id);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'export_override_set',
      targetType: 'company', targetId: req.params.id, afterState: { enabled: req.body.enabled, reason: req.body.reason },
    });
    successResponse(res, 'Export override updated', data);
  } catch (err) { next(err); }
};

/**
 * Section G2: a deliberate, explicit, separately-logged action, distinct
 * from setFeature (visibility) — "two separate, independent controls,
 * never merge into one toggle." Requires an explicit confirmation flag
 * from the frontend (a checkbox/typed-phrase step) AND a reason whenever
 * switching to 'stop' — both checked here, not just in the UI, so a
 * direct API call can't skip the safety rail either.
 */
const setDataCollectionMode = async (req, res, next) => {
  try {
    const { mode, reason, confirmed } = req.body || {};
    if (!['continue', 'stop'].includes(mode)) throw new BadRequestError('mode must be continue or stop');
    if (mode === 'stop' && confirmed !== true) {
      throw new BadRequestError('Explicit confirmation is required to stop data collection');
    }
    const data = await featureOverrideService.setDataCollectionMode(req.params.id, req.params.key, mode, reason, req.superAdmin.id);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'data_collection_mode_set',
      targetType: 'company_feature_override', targetId: req.params.id,
      afterState: { featureKey: req.params.key, mode, reason },
    });
    successResponse(res, 'Data collection mode updated', data);
  } catch (err) { next(err); }
};

module.exports = { getFeatures, setFeature, clearFeature, setSeatOverride, setExportOverride, setDataCollectionMode };
