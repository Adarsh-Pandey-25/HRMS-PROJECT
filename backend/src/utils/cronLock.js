const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * DB-backed advisory lock for scheduled jobs (audit finding M-10). Harmless
 * no-op contention at a single instance; the moment this backend ever runs
 * on more than one instance, this is what stops every instance's own
 * node-cron schedule + setInterval catch-up fallback from all firing the
 * same job independently.
 *
 * Acquire = INSERT a row for job_name; a unique-violation means another
 * instance already holds it, so this call skips. A lock whose locked_until
 * has already passed is treated as abandoned (a crashed process that never
 * reached release) and is cleared before the acquire attempt, so a crash
 * can't permanently block all future runs.
 */
const acquireLock = async (jobName, estimatedDurationMs) => {
  const now = new Date();
  await supabaseAdmin.from('cron_locks').delete().eq('job_name', jobName).lt('locked_until', now.toISOString());

  const { error } = await supabaseAdmin.from('cron_locks').insert({
    job_name: jobName,
    locked_at: now.toISOString(),
    locked_until: new Date(now.getTime() + estimatedDurationMs).toISOString(),
  });

  if (error) {
    if (error.code === '23505') return false; // another instance holds the lock
    // Migration not applied yet, or some other DB issue — fail open (run
    // the job) rather than silently never running a scheduled job at all
    // in an environment where cron_locks doesn't exist yet.
    logger.warn('[cronLock] acquire failed, proceeding without a lock', { jobName, error: error.message });
    return true;
  }
  return true;
};

const releaseLock = async (jobName) => {
  const { error } = await supabaseAdmin.from('cron_locks').delete().eq('job_name', jobName);
  if (error) logger.warn('[cronLock] release failed', { jobName, error: error.message });
};

/**
 * Audit finding N-14: a fixed estimatedDurationMs with no renewal meant a
 * run that legitimately took longer than the estimate had its lock treated
 * as abandoned by the next acquire attempt (the stale-cleanup DELETE in
 * acquireLock), letting a second instance start concurrently with the
 * first still genuinely running. Push locked_until forward periodically
 * while the job is actually still executing instead of trusting one
 * upfront guess for the whole run.
 */
const renewLock = async (jobName, estimatedDurationMs) => {
  const { error } = await supabaseAdmin
    .from('cron_locks')
    .update({ locked_until: new Date(Date.now() + estimatedDurationMs).toISOString() })
    .eq('job_name', jobName);
  if (error) logger.warn('[cronLock] renewal failed', { jobName, error: error.message });
};

/**
 * Module 7: cron_locks alone can't answer "when did this last run and did
 * it succeed" — a released lock's row is deleted, leaving no history. One
 * history row per run, written here (the single wrapper every cron job
 * already goes through) rather than adding logging to each of the 5 cron
 * files individually. Best-effort: a logging failure must never fail the
 * cron run it's describing.
 */
const recordRun = async (jobName, status, startedAt, error) => {
  try {
    await supabaseAdmin.from('cron_run_log').insert({
      job_name: jobName,
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
      error: error ? String(error.message || error) : null,
    });
  } catch (err) {
    logger.warn('[cronLock] Failed to record cron_run_log entry', { jobName, error: err.message });
  }
};

/** Wrap a cron job's run function so at most one instance executes it at a time. */
const withCronLock = (jobName, estimatedDurationMs, fn) => async (...args) => {
  const startedAt = new Date();
  const acquired = await acquireLock(jobName, estimatedDurationMs);
  if (!acquired) {
    logger.info(`[cronLock] Skipping ${jobName} — another instance holds the lock`);
    await recordRun(jobName, 'skipped', startedAt);
    return { skipped: true, reason: 'locked' };
  }
  // Renew at 1/3 of the estimate so a run that's still genuinely in
  // progress never lets locked_until lapse before the run itself finishes.
  const renewalInterval = setInterval(() => {
    renewLock(jobName, estimatedDurationMs).catch((err) => {
      logger.warn('[cronLock] renewal threw', { jobName, error: err.message });
    });
  }, Math.max(1000, Math.floor(estimatedDurationMs / 3)));
  try {
    const result = await fn(...args);
    await recordRun(jobName, 'success', startedAt);
    return result;
  } catch (err) {
    await recordRun(jobName, 'failed', startedAt, err);
    throw err;
  } finally {
    clearInterval(renewalInterval);
    await releaseLock(jobName);
  }
};

module.exports = { acquireLock, releaseLock, renewLock, withCronLock };
