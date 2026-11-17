const ipBeaconService = require('../services/ipBeacon.service');
const { successResponse, getTrustedClientIp } = require('../utils/helpers');

/**
 * Section D2: authenticated via X-Beacon-Secret, not an employee JWT — no
 * `authenticate` middleware in this route's chain (see ipBeaconPing.routes.js).
 * Minimal request shape (documented in the Section D report):
 *   POST /api/attendance/ip-beacon/:beaconKey/ping
 *   Header: X-Beacon-Secret: <raw secret>
 *   Body: {} (empty — the IP is resolved server-side from the request itself)
 */
const ping = async (req, res, next) => {
  try {
    const beaconSecret = req.headers['x-beacon-secret'];
    // The office's public IP as Cloudflare/nginx saw it — never a forwarded
    // header, or anyone holding the secret could whitelist any IP.
    const clientIp = getTrustedClientIp(req);
    const result = await ipBeaconService.recordPing(req.params.beaconKey, beaconSecret, clientIp);
    successResponse(res, 'Ping recorded', result);
  } catch (err) { next(err); }
};

module.exports = { ping };
