const express = require('express');
const attendanceController = require('../controllers/attendance.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { validateOfficeIp, attachClientIp } = require('../middleware/ipValidation.middleware');
const { validate } = require('../middleware/validation.middleware');
const { checkInRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/check-in', isEmployee, checkInRules, validate, validateOfficeIp, attendanceController.checkIn);
router.post('/check-out', isEmployee, attachClientIp, attendanceController.checkOut);
router.get('/check-context', isEmployee, attendanceController.checkContext);
router.post('/biometric-webhook', attendanceController.biometricWebhook);
router.get('/my-attendance', isEmployee, paginationQuery, validate, attendanceController.myAttendance);
router.get('/team-attendance', isManagerOrAbove, paginationQuery, validate, attendanceController.teamAttendance);
router.get('/all-attendance', isHROrAdmin, paginationQuery, validate, attendanceController.allAttendance);
router.get('/report/:employeeId', uuidParam('employeeId'), validate, attendanceController.employeeReport);
router.put('/manual-entry', isHROrAdmin, attendanceController.manualEntry);
router.get('/monthly-summary', isEmployee, attendanceController.monthlySummary);

module.exports = router;
