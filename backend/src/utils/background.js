const logger = require('./logger');

/**
 * Start work the response must not wait for — emails above all. With
 * throttling and retries (config/email.js) one email can take tens of
 * seconds when the mail server is busy; no screen should spin for that.
 * The work keeps the request's context (company, email type), and a failure
 * is logged rather than lost or thrown at the user. It is recorded in the
 * email log either way.
 */
const runInBackground = (label, work) => {
  Promise.resolve()
    .then(work)
    .catch((err) => logger.warn(`[Background] ${label} failed`, { error: err?.message }));
};

module.exports = { runInBackground };
