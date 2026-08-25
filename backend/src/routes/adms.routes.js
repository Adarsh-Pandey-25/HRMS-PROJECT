const express = require('express');
const admsController = require('../controllers/adms.controller');

// eSSL ADMS push protocol: the device sends plain HTTP with no auth headers
// and a raw tab-separated text body (not JSON, not form-urlencoded). This
// router is mounted in app.js BEFORE express.json()/urlencoded() and carries
// no auth middleware — both are required for a real device to talk to it.
const router = express.Router();

const rawText = express.text({ type: () => true, limit: '256kb' });

// Some firmware/relay clients (e.g. "iClock Proxy") use .aspx-suffixed paths
// instead of the plain ones — same protocol, just a different URL convention.
router.get(['/getrequest', '/getrequest.aspx'], admsController.getrequest);
router.post(['/deviceinfo', '/deviceinfo.aspx'], rawText, admsController.deviceinfo);
router.post(['/cdata', '/cdata.aspx'], rawText, admsController.cdata);

module.exports = router;
