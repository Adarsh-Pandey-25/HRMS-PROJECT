require('dotenv').config();
const app = require('./app');
const config = require('./config/database');
const logger = require('./utils/logger');
const { startAutoCheckoutCron } = require('./cron/autoCheckout.cron');
const { startAutoPayrollCron } = require('./cron/autoPayroll.cron');
const { startSubscriptionBillingCron } = require('./cron/subscriptionBilling.cron');
const { startAttendanceAnomalyCron } = require('./cron/attendanceAnomaly.cron');
const { startBackupCron } = require('./cron/backup.cron');
const { startBiometricWindowTransitionCron } = require('./cron/biometricWindowTransition.cron');

const PORT = config.port;

if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
  logger.error('JWT_SECRET must be set and at least 32 characters');
  process.exit(1);
}
if (!process.env.JWT_REFRESH_SECRET || String(process.env.JWT_REFRESH_SECRET).length < 32) {
  logger.error('JWT_REFRESH_SECRET must be set and at least 32 characters');
  process.exit(1);
}
if (config.env === 'production' && !process.env.SUPABASE_SERVICE_KEY) {
  logger.error('SUPABASE_SERVICE_KEY is required in production');
  process.exit(1);
}

const server = app.listen(PORT, config.host, () => {
  logger.info(`HRMS Backend running on ${config.host}:${PORT} [${config.env}]`);
  logger.info(`Timezone: ${config.timezone}`);
  startAutoCheckoutCron();
  startAutoPayrollCron();
  startSubscriptionBillingCron();
  startAttendanceAnomalyCron();
  startBackupCron();
  startBiometricWindowTransitionCron();
  // Tag legacy employees under the default company so new workspaces stay empty
  require('./services/tenant.service').ensureTenantBackfill()
    .then(() => require('./services/settings.service').migrateLegacySettingsToDefaultCompany())
    .then(() => require('./services/superAdmin.service').ensureSeedSuperAdmin())
    .catch((err) => {
      logger.error('FATAL: Startup migration chain failed', { error: err.message, stack: err.stack });
      process.exit(1);
    });
});

process.on('unhandledRejection', (err) => {
  // Matches uncaughtException's policy below: an unhandled rejection can
  // leave the process holding a partially-completed async operation in an
  // inconsistent state — logging and continuing risks serving requests
  // against corrupted in-memory state. Exit and let the process manager
  // (PM2/Docker) restart cleanly, same as a synchronous uncaught exception.
  logger.error('Unhandled Rejection', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
// SIGINT (Ctrl+C locally, and some orchestrators/PaaS) previously had no
// handler at all — Node's default behavior is an immediate hard kill with
// no drain of in-flight requests. Mirror SIGTERM's graceful shutdown.
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;
