require('dotenv').config();
const app = require('./app');
const config = require('./config/database');
const logger = require('./utils/logger');
const { startAutoCheckoutCron } = require('./cron/autoCheckout.cron');

const PORT = config.port;

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
