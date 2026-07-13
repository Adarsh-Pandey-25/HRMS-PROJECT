const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, authorize } = require('../middleware/role.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticate);

router.get('/admin', isHROrAdmin, dashboardController.getAdminDashboard);
router.get('/hr', isHROrAdmin, dashboardController.getHrDashboard);
router.get('/manager', authorize(ROLES.MANAGER), dashboardController.getManagerDashboard);
router.get('/employee', authorize(ROLES.EMPLOYEE), dashboardController.getEmployeeDashboard);
router.get('/search', dashboardController.search);

module.exports = router;
