/**
 * Enforce a minimum password policy:
 *  - at least 8 characters
 *  - at least one uppercase letter
 *  - at least one lowercase letter
 *  - at least one digit
 *  - at least one special character
 *
 * The *exposed* failure message is intentionally generic ("Password does
 * not meet complexity requirements") regardless of which check failed.
 * Per-rule messages are kept internally only — revealing them would turn
 * the API into a free online rule-oracle a brute-forcer could iterate
 * against (e.g. "try again, this time add a digit").
 */
function validatePassword(password, ErrorClass) {
  const issues = [];
  if (!password || password.length < 8) issues.push('length');
  if (!/[A-Z]/.test(password || '')) issues.push('uppercase');
  if (!/[a-z]/.test(password || '')) issues.push('lowercase');
  if (!/[0-9]/.test(password || '')) issues.push('digit');
  if (!/[^A-Za-z0-9]/.test(password || '')) issues.push('special');

  if (issues.length) {
    const err = new ErrorClass('Password does not meet complexity requirements');
    err.statusCode = 400;
    throw err;
  }
}

module.exports = { validatePassword };
