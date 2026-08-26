const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, authorize, isEmployee } = require('../middleware/role.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticate);

router.get('/admin', isHROrAdmin, dashboardController.getAdminDashboard);
router.get('/hr', isHROrAdmin, dashboardController.getHrDashboard);
router.get('/manager', authorize(ROLES.MANAGER), dashboardController.getManagerDashboard);
router.get('/employee', authorize(ROLES.EMPLOYEE), dashboardController.getEmployeeDashboard);
// Real user session only — an api_key (role 'api_key', e.g. a device attendance-write
// key) must never be able to enumerate employees/announcements via search.
router.get('/search', isEmployee, dashboardController.search);

module.exports = router;
