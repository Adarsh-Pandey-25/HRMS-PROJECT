const express = require('express');
const ipBeaconPingController = require('../controllers/ipBeaconPing.controller');
const { beaconPingLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

/**
 * Section D2: deliberately NO `authenticate` middleware — this is hit
 * directly by a MacroDroid-style push app on a phone/device, not a logged-in
 * employee. Auth is X-Beacon-Secret, verified inside the service against
 * the per-beacon hash (see ipBeacon.service.js's verifyBeaconAuth).
 */
router.post('/:beaconKey/ping', beaconPingLimiter, ipBeaconPingController.ping);

module.exports = router;
