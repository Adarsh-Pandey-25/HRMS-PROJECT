const express = require('express');
const attendanceController = require('../controllers/attendance.controller');
const admsController = require('../controllers/adms.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { requireApiScope } = require('../middleware/apiKey.middleware');
const { attachClientIp } = require('../middleware/ipValidation.middleware');
const { validate } = require('../middleware/validation.middleware');
const { checkInRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

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
router.get('/team-attendance', isManagerOrAbove, paginationQuery, validate, attendanceController.teamAttendance);
router.get('/all-attendance', isHROrAdmin, paginationQuery, validate, attendanceController.allAttendance);
router.get('/report/:employeeId', uuidParam('employeeId'), validate, attendanceController.employeeReport);
router.put('/manual-entry', isHROrAdmin, attendanceController.manualEntry);
router.get('/monthly-summary', isEmployee, attendanceController.monthlySummary);

// ADMS biometric device (raw punch log — see backend/src/routes/adms.routes.js for the device push endpoints)
router.get('/adms/test', isHROrAdmin, admsController.testStatus);
router.put('/adms/devices/:serial', isHROrAdmin, admsController.registerDevice);
router.get('/device-punches/today', isEmployee, admsController.todayPunches);

const wfhRequestController = require('../controllers/wfhRequest.controller');
router.post('/wfh-requests', isEmployee, wfhRequestController.request);
router.get('/wfh-requests/mine', isEmployee, paginationQuery, validate, wfhRequestController.myRequests);
router.delete('/wfh-requests/:id', isEmployee, uuidParam(), validate, wfhRequestController.cancel);
router.get('/wfh-requests/pending', isManagerOrAbove, paginationQuery, validate, wfhRequestController.pending);
router.put('/wfh-requests/:id/review', isManagerOrAbove, uuidParam(), validate, wfhRequestController.review);

module.exports = router;
