const ipBeaconService = require('../services/ipBeacon.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

const list = async (req, res, next) => {
  try {
    successResponse(res, 'Beacons fetched', await ipBeaconService.listBeacons(req.user.company_id));
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await ipBeaconService.createBeacon(
      req.user.company_id, { label: req.body.label, expectedRegion: req.body.expected_region }, req.user.id,
    );
    successResponse(res, 'Beacon created — copy the secret now, it will not be shown again', data, null, 201);
  } catch (err) { next(err); }
};

const revoke = async (req, res, next) => {
  try {
    successResponse(res, 'Beacon revoked', await ipBeaconService.revokeBeacon(req.user.company_id, req.params.id, req.user.id));
  } catch (err) { next(err); }
};

const listPending = async (req, res, next) => {
  try {
    successResponse(res, 'Pending approvals fetched', await ipBeaconService.listPendingApprovals(req.user.company_id));
  } catch (err) { next(err); }
};

const resolvePending = async (req, res, next) => {
  try {
    const decision = req.body.decision;
    if (!['approved', 'rejected'].includes(decision)) throw new BadRequestError('decision must be approved or rejected');
    successResponse(res, 'Pending approval resolved', await ipBeaconService.resolvePendingApproval(req.user.company_id, req.params.id, decision, req.user.id));
  } catch (err) { next(err); }
};

module.exports = { list, create, revoke, listPending, resolvePending };
