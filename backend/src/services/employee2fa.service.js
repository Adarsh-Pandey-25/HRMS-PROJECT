const { supabaseAdmin } = require('../config/supabase');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { UnauthorizedError, BadRequestError } = require('../utils/errors');
const totp = require('../utils/totp');
const { getCompanyId } = require('../utils/tenant');

/**
 * Employee self-service 2FA — uses the same totp.js + AES-256-GCM
 * pattern as super-admin 2FA, with the same SUPER_ADMIN_2FA_ENC_KEY
 * (not a separate key). These are the same class of secret: a TOTP
 * seed that must be decrypted on every login to verify a code.
 */

/**
 * Generate a new TOTP secret and store it in pending state (not yet enabled).
 * The QR image is rendered here (same `qrcode` package as super-admin 2FA) so
 * the browser needs no QR library. The secret goes back as `manualEntryKey`
 * because successResponse() strips any key literally named `secret`.
 */
const generateTotpSecret = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, email, two_fa_enabled')
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !employee) throw new BadRequestError('Employee not found');
  // Re-enrolling would overwrite the live secret before the new one is
  // confirmed and lock the user out of their next login.
  if (employee.two_fa_enabled) throw new BadRequestError('Two-factor authentication is already on. Turn it off first to set up a new device.');

  const secret = totp.generateSecret();
  const encrypted = totp.encryptSecret(secret);

  await supabaseAdmin
    .from('employees')
    .update({ totp_secret: encrypted, updated_at: new Date().toISOString() })
    .eq('id', employeeId);

  const otpauthUri = totp.buildOtpauthUri(secret, employee.email, 'SpaxSync');
  const qrDataUri = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 });

  return { manualEntryKey: secret, otpauthUri, qrDataUri };
};

/** Verify the code against the stored (pending) secret and flip 2FA on. */
const verifyAndEnableTotpFor = async (employeeId, totpCode) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, totp_secret')
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !employee) throw new BadRequestError('Employee not found');
  if (!employee.totp_secret) throw new BadRequestError('No pending 2FA enrollment — set up first');

  const secret = totp.decryptSecret(employee.totp_secret);
  if (!totp.verifyTotp(secret, totpCode)) throw new UnauthorizedError('Invalid code — check your authenticator app');

  await supabaseAdmin
    .from('employees')
    .update({ two_fa_enabled: true, updated_at: new Date().toISOString() })
    .eq('id', employeeId);

  return { success: true };
};

/** Disable 2FA — requires a valid current code to prove device possession. */
const disableTotp = async (employeeId, totpCode) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, totp_secret, two_fa_enabled')
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !employee) throw new BadRequestError('Employee not found');
  if (!employee.two_fa_enabled) return { success: true, alreadyDisabled: true };

  if (!employee.totp_secret) throw new BadRequestError('2FA secret missing — contact support');
  const secret = totp.decryptSecret(employee.totp_secret);
  if (!totp.verifyTotp(secret, totpCode)) throw new UnauthorizedError('Invalid code');

  await supabaseAdmin
    .from('employees')
    .update({ two_fa_enabled: false, totp_secret: null, updated_at: new Date().toISOString() })
    .eq('id', employeeId);

  return { success: true };
};

/** Verify a TOTP code against the employee's stored secret (used during login flow). */
const verifyTotpCode = async (employeeId, totpCode) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, totp_secret, two_fa_enabled')
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !employee) return false;
  if (!employee.two_fa_enabled || !employee.totp_secret) return false;

  try {
    const secret = totp.decryptSecret(employee.totp_secret);
    return totp.verifyTotp(secret, totpCode);
  } catch {
    return false;
  }
};

/**
 * Issue a short-lived "2fa_pending" JWT after password succeeds.
 * This token is NOT an access token — it can only be used at
 * /api/auth/2fa/verify-login to complete the login with a TOTP code.
 */
const issueTwoFaPendingToken = (employee) => {
  const payload = {
    id: employee.id,
    email: employee.email,
    company_id: getCompanyId(employee),
    scope: 'two_fa_pending',
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
};

module.exports = {
  generateTotpSecret,
  verifyAndEnableTotpFor,
  disableTotp,
  verifyTotpCode,
  issueTwoFaPendingToken,
};
