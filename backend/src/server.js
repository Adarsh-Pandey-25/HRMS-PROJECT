require('dotenv').config();
const app = require('./app');
const config = require('./config/database');
const logger = require('./utils/logger');
const { startAutoCheckoutCron } = require('./cron/autoCheckout.cron');

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
  logger.info(`HRMS Backend running on port ${PORT} [${config.env}]`);
  logger.info(`Timezone: ${config.timezone}`);
  startAutoCheckoutCron();
  // Tag legacy employees under the default company so new workspaces stay empty
  require('./services/tenant.service').ensureTenantBackfill()
    .then(() => require('./services/settings.service').migrateLegacySettingsToDefaultCompany())
    .catch(() => {});
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection', { error: err.message, stack: err.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});

module.exports = server;
