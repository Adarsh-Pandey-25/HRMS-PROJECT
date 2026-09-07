const geofenceService = require('../services/geofence.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse } = require('../utils/helpers');

const list = async (req, res, next) => {
  try {
    const includeInactive = String(req.query.include_inactive || '') === 'true';
    successResponse(res, 'Geofences fetched', await geofenceService.listGeofences(req.user.company_id, { includeInactive }));
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await geofenceService.createGeofence(req.user.company_id, {
      label: req.body.label,
      centerLatitude: req.body.center_latitude,
      centerLongitude: req.body.center_longitude,
      radiusMeters: req.body.radius_meters,
    }, req.user.id);
    await auditLogService.logAudit({
      companyId: req.user.company_id, actorId: req.user.id, actorRole: req.user.role,
      actionType: 'geofence_created', targetType: 'geofence', targetId: data.id, afterState: data,
    });
    successResponse(res, 'Geofence created', data, null, 201);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const data = await geofenceService.updateGeofence(req.user.company_id, req.params.id, {
      label: req.body.label,
      centerLatitude: req.body.center_latitude,
      centerLongitude: req.body.center_longitude,
      radiusMeters: req.body.radius_meters,
      isActive: req.body.is_active,
    });
    await auditLogService.logAudit({
      companyId: req.user.company_id, actorId: req.user.id, actorRole: req.user.role,
      actionType: 'geofence_updated', targetType: 'geofence', targetId: data.id, afterState: data,
    });
    successResponse(res, 'Geofence updated', data);
  } catch (err) { next(err); }
};

const deactivate = async (req, res, next) => {
  try {
    const data = await geofenceService.deactivateGeofence(req.user.company_id, req.params.id);
    await auditLogService.logAudit({
      companyId: req.user.company_id, actorId: req.user.id, actorRole: req.user.role,
      actionType: 'geofence_deactivated', targetType: 'geofence', targetId: data.id,
    });
    successResponse(res, 'Geofence deactivated', data);
  } catch (err) { next(err); }
};

module.exports = { list, create, update, deactivate };
