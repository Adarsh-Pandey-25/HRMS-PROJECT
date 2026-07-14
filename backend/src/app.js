const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const config = require('./config/database');
const { generalLimiter } = require('./middleware/rateLimiter.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler.middleware');
const { handleMulterError } = require('./middleware/upload.middleware');

const authRoutes = require('./routes/auth.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const leaveRoutes = require('./routes/leave.routes');
const payrollRoutes = require('./routes/payroll.routes');
const reimbursementRoutes = require('./routes/reimbursement.routes');
const trainingRoutes = require('./routes/training.routes');
const announcementRoutes = require('./routes/announcement.routes');
const holidayRoutes = require('./routes/holiday.routes');
const documentRoutes = require('./routes/document.routes');
const employeeRoutes = require('./routes/employee.routes');
const settingsRoutes = require('./routes/settings.routes');
const reportsRoutes = require('./routes/reports.routes');
const notificationRoutes = require('./routes/notification.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const assetsRoutes = require('./routes/assets.routes');
const performanceRoutes = require('./routes/performance.routes');
const recruitmentRoutes = require('./routes/recruitment.routes');
const helpdeskRoutes = require('./routes/helpdesk.routes');

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(cors(config.cors));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(generalLimiter);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'HRMS Backend API',
    version: '1.0.0',
    docs: 'Use Postman collection: backend/postman/HRMS-API.postman_collection.json',
    endpoints: {
      health: 'GET /health',
      auth: '/api/auth',
      employees: '/api/employees',
      attendance: '/api/attendance',
      leaves: '/api/leaves',
      payroll: '/api/payroll',
      reimbursements: '/api/reimbursements',
      training: '/api/training',
      announcements: '/api/announcements',
      holidays: '/api/holidays',
      documents: '/api/documents',
    },
    timestamp: new Date().toISOString(),
    timezone: config.timezone,
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'HRMS API is running',
    timestamp: new Date().toISOString(),
    timezone: config.timezone,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/reimbursements', reimbursementRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/helpdesk', helpdeskRoutes);

app.use(notFoundHandler);
app.use(handleMulterError);
app.use(errorHandler);

module.exports = app;
