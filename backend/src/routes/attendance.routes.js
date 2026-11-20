const express = require('express');
const attendanceController = require('../controllers/attendance.controller');
const admsController = require('../controllers/adms.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { requireApiScope } = require('../middleware/apiKey.middleware');
const { attachClientIp } = require('../middleware/ipValidation.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { upload } = require('../middleware/upload.middleware');
const { requirePermission, isOwnId } = require('../middleware/requirePermission');
const { checkInRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Settings → User & Role Management → Attendance Tracking. A person's own
// attendance, punches and WFH requests never need it.
const can = (action, options) => requirePermission('attendance', action, options);
// Biometric devices are set up under Settings → Attendance Config, so they need
// Settings → Manage as well.
const manageDevices = [requirePermission('settings', 'manage'), can('manage')];

router.post('/selfie', isEmployee, upload.single('photo'), attendanceController.uploadSelfie);
router.post('/check-in', isEmployee, checkInRules, validate, attachClientIp, attendanceController.checkIn);
router.post('/check-out', isEmployee, attachClientIp, attendanceController.checkOut);
router.get('/check-context', isEmployee, attendanceController.checkContext);
// Devices only: X-API-Key with scope attendance:write (JWT users cannot punch for others)
router.post(
  '/biometric-webhook',
  requireApiScope('attendance:write'),
  attendanceController.biometricWebhook,
);
router.get('/my-attendance', isEmployee, paginationQuery, validate, attendanceController.myAttendance);
router.get('/team-attendance', isManagerOrAbove, can('view'), paginationQuery, validate, attendanceController.teamAttendance);
router.get('/all-attendance', isHROrAdmin, can('view'), paginationQuery, validate, attendanceController.allAttendance);
router.get('/report/:employeeId', can('view', { selfService: (req) => isOwnId(req, req.params.employeeId) }), uuidParam('employeeId'), validate, attendanceController.employeeReport);
router.put('/manual-entry', isHROrAdmin, can('manage'), attendanceController.manualEntry);
router.get('/monthly-summary', isEmployee, attendanceController.monthlySummary);

// ADMS biometric device (raw punch log — see backend/src/routes/adms.routes.js for the device push endpoints)
// Item 8B: device MANAGEMENT (not punch ingestion — that's /iclock/*, never
// gated) — a company can't see or register devices at all while the
// feature is off, even though ingestion for already-claimed devices
// continues unconditionally in the background (see adms.service.js).
router.get('/adms/test', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.testStatus);
router.put('/adms/devices/:serial', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.registerDevice);
router.delete('/adms/devices/:serial', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.releaseDevice);
// Device IP pinning (adms.service.js): accept the IP a device now reports from, or forget its IP so its next request pins one.
router.post('/adms/devices/:serial/allow-new-ip', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.allowDeviceNewIp);
router.post('/adms/devices/:serial/reject-new-ip', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.rejectDeviceNewIp);
router.post('/adms/devices/:serial/relearn-ip', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.relearnDeviceIp);
// Who is asked to approve a device's new IP (admsIpApproval.service.js): HR and Admins by default, plus anyone ticked.
router.get('/adms/ip-approvers', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.getIpApprovers);
router.put('/adms/ip-approvers', isHROrAdmin, manageDevices, requireFeature('biometric_adms'), admsController.saveIpApprovers);
router.get('/device-punches/today', isEmployee, admsController.todayPunches);

const wfhRequestController = require('../controllers/wfhRequest.controller');
router.post('/wfh-requests', isEmployee, wfhRequestController.request);
router.get('/wfh-requests/mine', isEmployee, paginationQuery, validate, wfhRequestController.myRequests);
router.delete('/wfh-requests/:id', isEmployee, uuidParam(), validate, wfhRequestController.cancel);
router.get('/wfh-requests/pending', isManagerOrAbove, can('approve'), paginationQuery, validate, wfhRequestController.pending);
router.put('/wfh-requests/:id/review', isManagerOrAbove, can('approve'), uuidParam(), validate, wfhRequestController.review);

module.exports = router;
