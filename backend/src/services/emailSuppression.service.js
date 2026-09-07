const featureOverrideService = require('./featureOverride.service');
const logger = require('../utils/logger');

/**
 * Section G1: the ONE shared gate every feature-linked email must pass
 * through before dispatch — reused everywhere, never scattered as
 * per-call-site if-checks. HARD RULE, NO EXCEPTIONS: if a feature's
 * VISIBILITY is off for a company, zero emails tied to that feature go
 * out, regardless of data_collection_mode, regardless of what internal
 * calculations still need the data. Internal calculations (LOP math,
 * anomaly detection) are never touched by this gate — it only ever
 * intercepts the outward `sendEmail` call.
 */
const isFeatureEmailSuppressed = async (companyId, featureKey) => {
  const enabled = await featureOverrideService.hasFeature(companyId, featureKey);
  return !enabled;
};

/**
 * Wraps a send: if suppressed, logs internally (never visible to the
 * company — a plain logger line, same as every other internal-only
 * diagnostic in this codebase) and returns without sending. Otherwise
 * runs `sendFn`. Centralizes both the check AND the no-op/log behavior so
 * call sites can't accidentally skip the logging half of the contract.
 */
const guardedSend = async (companyId, featureKey, emailType, sendFn) => {
  if (await isFeatureEmailSuppressed(companyId, featureKey)) {
    logger.info('[EmailSuppression] Suppressed — feature visibility is off', { companyId, featureKey, emailType });
    return { sent: false, suppressed: true };
  }
  await sendFn();
  return { sent: true, suppressed: false };
};

module.exports = { isFeatureEmailSuppressed, guardedSend };
