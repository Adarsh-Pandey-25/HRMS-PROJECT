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
const { startBirthdayAnniversaryCron } = require('./cron/birthdayAnniversary.cron');
const { startOnboardingCron } = require('./cron/onboarding.cron');
const { startWeeklyDigestCrons } = require('./cron/weeklyDigest.cron');
const { startSalaryRevisionCron } = require('./cron/salaryRevision.cron');

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

/**
 * Fail fast on secrets that used to fail at first use instead of at boot.
 *
 * SUPER_ADMIN_2FA_ENC_KEY encrypts both super-admin and employee TOTP seeds
 * (utils/totp.js). Unset, every 2FA enrol/verify/disable returned a generic
 * 500; wrong-length, it silently derived a different key and locked users
 * out with "invalid code". Validated here with the same decoder the runtime
 * uses, so the two can never disagree.
 */
try {
  require('./utils/totp').decodeEncryptionKey(process.env.SUPER_ADMIN_2FA_ENC_KEY);
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

// Production-only: both have silent-degradation fallbacks that are fine in
// dev but wrong in production.
if (config.env === 'production') {
  // Unset, utils/host.js classifies every host as 'other' — subdomain-per-tenant
  // routing goes inert and tenant links fall back to FRONTEND_URL.
  if (!process.env.BASE_DOMAIN) {
    logger.error('BASE_DOMAIN is required in production (e.g. BASE_DOMAIN=spaxsync.com) — subdomain-per-tenant routing depends on it');
    process.exit(1);
  }
  // Unset, utils/auditIntegrity.js signs audit rows with JWT_SECRET, so
  // rotating JWT_SECRET silently invalidates every existing signature.
  if (!process.env.AUDIT_LOG_HMAC_KEY) {
    logger.error('AUDIT_LOG_HMAC_KEY is required in production — without it audit-log signatures fall back to JWT_SECRET, and rotating JWT_SECRET would invalidate them all. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    process.exit(1);
  }
  // FRONTEND_URL has a localhost:5173 fallback in three services, which would
  // mint onboarding invite links that can never work.
  if (!process.env.FRONTEND_URL) {
    logger.error('FRONTEND_URL is required in production — onboarding invite and tenant links fall back to http://localhost:5173 without it');
    process.exit(1);
  }
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
  startBirthdayAnniversaryCron();
  startOnboardingCron();
  startWeeklyDigestCrons();
  startSalaryRevisionCron();
  // Tag legacy employees under the default company so new workspaces stay empty
  require('./services/tenant.service').ensureTenantBackfill()
    .then(() => require('./services/settings.service').migrateLegacySettingsToDefaultCompany())
    .then(() => require('./services/superAdmin.service').ensureSeedSuperAdmin())
    .catch((err) => {
      logger.error('FATAL: Startup migration chain failed', { error: err.message, stack: err.stack });
      process.exit(1);
    });
});

// Slow-loris / hung-connection defenses — kill idle keep-alive and
// any request that has not finished receiving headers within 31 s.
server.requestTimeout  = 30_000;
server.headersTimeout  = 31_000;
server.keepAliveTimeout = 5_000;

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
