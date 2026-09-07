const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const backupService = require('../services/backup.service');

const FREQUENCY_DAYS = { daily: 1, weekly: 7, monthly: 28 };

/** Item 6: "Auto-backup enabled" + "Frequency" were a stored preference nothing consumed — this is what actually reads and acts on it now. */
const isBackupDue = (frequency, lastBackup) => {
  if (!lastBackup?.completed_at) return true; // never backed up — due immediately
  const daysSince = moment().diff(moment(lastBackup.completed_at), 'days');
  return daysSince >= (FREQUENCY_DAYS[frequency] || 1);
};

const runScheduledBackups = withCronLock('scheduled_backups', 30 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running scheduled backups (${reason})`);
  const tenantService = require('../services/tenant.service');
  const settingsService = require('../services/settings.service');
  const companies = await tenantService.listActiveCompanies();
  const summary = { reason, companies: companies.length, ran: 0, skipped: 0, errors: 0 };

  for (const company of companies) {
    try {
      // Same default shape as the frontend's Zustand store default
      // (autoBackupEnabled: true) — a company that never explicitly saved
      // this setting sees "enabled" in the UI, so the cron treats it the
      // same way rather than silently doing nothing until they hit Save.
      const cfg = await settingsService.getSetting('backup_config', { autoBackupEnabled: true, autoBackupFrequency: 'daily' }, company.id);
      if (!cfg?.autoBackupEnabled) { summary.skipped += 1; continue; }

      const last = await backupService.getLastBackup(company.id);
      if (!isBackupDue(cfg.autoBackupFrequency, last)) { summary.skipped += 1; continue; }

      const log = await backupService.runBackup(company.id, 'scheduled', null);
      if (log?.status === 'failed') summary.errors += 1;
      else summary.ran += 1;
    } catch (err) {
      summary.errors += 1;
      logger.error('[Backup] Scheduled run failed for company', { companyId: company.id, error: err.message });
    }
  }

  if (summary.errors > 0) {
    await alertOnCronFailure('scheduledBackups', `${summary.errors} of ${summary.companies} companies failed`).catch((e) => {
      logger.error('[CRON] alertOnCronFailure itself failed', { job: 'scheduledBackups', error: e.message });
    });
  }

  logger.info('Scheduled backups completed', summary);
  return summary;
});

const startBackupCron = () => {
  // Once a day is enough granularity to serve daily/weekly/monthly
  // schedules — isBackupDue decides whether each company is actually due.
  cron.schedule('30 3 * * *', () => runScheduledBackups('cron'), { timezone: config.timezone });
  logger.info(`Scheduled backups cron scheduled for 3:30 AM ${config.timezone}`);
};

module.exports = { startBackupCron, runScheduledBackups, isBackupDue };
