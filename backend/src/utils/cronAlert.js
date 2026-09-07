const logger = require('./logger');

/**
 * Same settings-backed, rate-limited email-alert mechanism as
 * adms.service.js's alertOnSaveFailure/alertOnUnauthorizedDevice — reused
 * here, not reinvented, for cron job failures. Before this, autoCheckout/
 * autoPayroll failures only ever reached Winston; nothing notified a human.
 *
 * Backed by system_settings (not an in-memory variable) so the cooldown is
 * shared across every server instance/worker, not reset per-process — same
 * reasoning as the ADMS version. Keyed per job name so each cron job's
 * cooldown is independent of ADMS alerts and of every other cron job.
 */
const CRON_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

const alertOnCronFailure = async (jobName, errorMessage, meta = {}) => {
  const settingsService = require('../services/settings.service');
  const settingKey = `cron_${jobName}_last_alert_at`;
  const now = Date.now();
  const lastAlertIso = await settingsService.getSetting(settingKey, null, null);
  const lastAlertAt = lastAlertIso ? new Date(lastAlertIso).getTime() : 0;
  if (now - lastAlertAt < CRON_ALERT_COOLDOWN_MS) return;
  await settingsService.setSetting(settingKey, new Date(now).toISOString(), null, null);

  const to = process.env.SUPER_ADMIN_EMAIL;
  if (!to) return;

  const { sendEmail } = require('../services/email.service');
  const timestamp = new Date(now).toISOString();
  sendEmail({
    to,
    subject: `[CRON ALERT] ${jobName} failed`,
    html: `<p>Scheduled job <strong>${jobName}</strong> failed and did not complete.</p>
${meta.companyId ? `<p>Company: <code>${meta.companyId}</code></p>` : ''}
<p>Error: <code>${errorMessage}</code></p>
<p>Time: <code>${timestamp}</code></p>
<p>Check the ${jobName} logs and re-run manually if needed.</p>
<p>(This alert is rate-limited to once every 15 minutes while the failure continues.)</p>`,
  }).catch((e) => logger.error(`[CRON] Failed to send ${jobName} failure alert email`, { error: e.message }));
};

module.exports = { alertOnCronFailure };
