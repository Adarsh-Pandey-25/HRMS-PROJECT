const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const config = require('./config/database');
const { supabaseAdmin } = require('./config/supabase');
const { generalLimiter, admsLimiter } = require('./middleware/rateLimiter.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler.middleware');
const { handleMulterError } = require('./middleware/upload.middleware');
const { resolveTenantSubdomain } = require('./middleware/tenantSubdomain.middleware');
const { requireCsrfHeader } = require('./middleware/csrf.middleware');

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
const companyRoutes = require('./routes/company.routes');
const apiKeyRoutes = require('./routes/apiKey.routes');
const integrationRoutes = require('./routes/integration.routes');
const superAdminRoutes = require('./routes/superAdmin.routes');
const admsRoutes = require('./routes/adms.routes');
const deviceMappingRoutes = require('./routes/deviceMapping.routes');
const ipWhitelistRoutes = require('./routes/ipWhitelist.routes');
const geofenceRoutes = require('./routes/geofence.routes');
const beaconRoutes = require('./routes/ipBeacon.routes');
const beaconPingRoutes = require('./routes/ipBeaconPing.routes');
const billingRoutes = require('./routes/tenantBilling.routes');
const onboardingChecklistRoutes = require('./routes/onboardingChecklist.routes');
const webhookRoutes = require('./routes/webhook.routes');
const auditLogRoutes = require('./routes/auditLog.routes');

const app = express();

app.disable('x-powered-by');
// Local Vite/ngrok: loopback only. Render/production: trust the first proxy hop for HTTPS cookies.
app.set('trust proxy', config.env === 'production' || process.env.RENDER ? 1 : 'loopback');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  // Audit finding N-22: explicit, minimal CSP rather than helmet's generic
  // default set. This is a JSON API with no HTML views of its own — deny
  // everything by default (scripts/styles/images/connects/etc. all have no
  // reason to load anything here) and explicitly block this origin from
  // ever being framed (frameAncestors), a clickjacking defense that still
  // applies even to an API that occasionally returns an HTML error page.
  // useDefaults: false so this is genuinely just these two directives, not
  // helmet's own opinionated defaults (script-src/style-src/etc.) merged
  // in underneath — there's nothing here for those to sensibly apply to.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(compression());
app.use(cors(config.cors));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// eSSL ADMS device endpoints: no auth, raw text body — must sit before the
// JSON/urlencoded parsers below or the device's tab-separated body gets mangled.
// generalLimiter (below) never reaches this router since it fully handles and
// returns before that point, so it gets its own dedicated per-IP limiter here.
app.use('/iclock', admsLimiter, admsRoutes);

app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(generalLimiter);
app.use(resolveTenantSubdomain);

const HEALTH_CHECK_TIMEOUT_MS = 3000;

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timed out')), ms)),
]);

/** A static 200 here would report healthy during a total Supabase outage —
 *  do one cheap real query so orchestrator liveness/readiness probes and
 *  uptime monitors actually reflect whether this instance can serve a
 *  request at all. */
const checkDbHealth = async () => {
  try {
    const { error } = await withTimeout(
      supabaseAdmin.from('companies').select('id').limit(1),
      HEALTH_CHECK_TIMEOUT_MS,
    );
    return !error;
  } catch {
    return false;
  }
};

const healthHandler = async (req, res) => {
  const dbOk = await checkDbHealth();
  if (!dbOk) {
    return res.status(503).json({ success: false, error: 'database_unreachable' });
  }
  res.json({ success: true, db: 'ok', timestamp: new Date().toISOString() });
};

app.get('/', healthHandler);
app.get('/health', healthHandler);

// CSRF (H-08): mounted after CORS/body-parsers, before every /api/* route —
// applies to all of them uniformly, including auth. /iclock/* device routes
// are mounted earlier (line 58) and fully handled before requests ever
// reach here, so they're unaffected.
app.use('/api', requireCsrfHeader);

app.use('/api/auth', authRoutes);
// Section D: registered BEFORE /api/attendance (below) — both are
// sub-paths of it (/attendance/beacons, /attendance/ip-beacon), and
// Express tries mounted routers in registration order for overlapping
// prefixes. attendanceRoutes' own `router.use(authenticate)` would
// otherwise intercept every request under /api/attendance/* — including
// the beacon ping endpoint's own unauthenticated-by-JWT requests — before
// ever reaching these two routers.
app.use('/api/attendance/beacons', beaconRoutes);
app.use('/api/attendance/ip-beacon', beaconPingRoutes);
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
app.use('/api/companies', companyRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/integration', integrationRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/device-mapping', deviceMappingRoutes);
app.use('/api/ip-whitelist', ipWhitelistRoutes);
app.use('/api/geofences', geofenceRoutes);
app.use('/api/attendance/beacons', beaconRoutes);
// Ping is unauthenticated-by-JWT (X-Beacon-Secret instead, verified in the
// controller) — deliberately a SEPARATE mount from /attendance/beacons
// above, which requires a full HR/Admin employee session.
app.use('/api/attendance/ip-beacon', beaconPingRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/onboarding-checklist-templates', onboardingChecklistRoutes);
app.use('/api/audit-logs', auditLogRoutes);

app.use(notFoundHandler);
app.use(handleMulterError);
app.use(errorHandler);

module.exports = app;
