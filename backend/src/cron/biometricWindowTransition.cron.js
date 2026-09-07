const attendanceService = require('../services/attendance.service');
const logger = require('../utils/logger');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');

/**
 * Transitions pending/provisional biometric attendance windows purely from
 * time passing — no new punch required to trigger it. This is what closes
 * out an employee who scanned once and never again (replacing the old
 * fixed-4AM job for biometric specifically — see the investigation note on
 * why a single fixed clock time doesn't line up with arbitrary
 * shift-anchored window closes, e.g. a 22:00 Night Shift). Runs every 15
 * minutes so a shift's pending→provisional or provisional→finalized moment
 * is never more than ~15 minutes stale.
 */
const runBiometricWindowTransition = withCronLock('biometric_window_transition', 5 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running biometric window transition sweep (${reason})`);
  try {
    const result = await attendanceService.transitionPendingBiometricWindows();
    logger.info('Biometric window transition sweep completed', { reason, ...result });
    return result;
  } catch (err) {
    logger.error('Biometric window transition sweep failed', { reason, error: err.message });
    await alertOnCronFailure('biometricWindowTransition', err.message).catch((e) => {
      logger.error('[CRON] alertOnCronFailure itself failed', { job: 'biometricWindowTransition', error: e.message });
    });
    return { processed: 0, error: err.message };
  }
});

const startBiometricWindowTransitionCron = () => {
  // Catch up on server start, same reasoning as autoCheckout/attendanceAnomaly.
  runBiometricWindowTransition('startup').catch(() => {});

  // No node-cron schedule needed (unlike the fixed-4AM job) — this has to
  // run continuously, not at one clock time, since windows close at
  // whatever time each shift's own start + 24h happens to be.
  setInterval(() => runBiometricWindowTransition('interval'), 15 * 60 * 1000);

  logger.info('Biometric window transition sweep scheduled every 15 minutes');
};

module.exports = { startBiometricWindowTransitionCron, runBiometricWindowTransition };
